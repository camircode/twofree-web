import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerApiError, serverApiFetch } from "../lib/server-api";
import {
  dashboardViewToState,
  loadDashboardState,
  type DashboardApiResponse,
} from "../lib/dashboard-adapter";
import { formatMoneyDto } from "../lib/money";

vi.mock("../lib/server-api", () => {
  class MockServerApiError extends Error {
    readonly status: number;

    constructor(status: number) {
      super("Server API request failed");
      this.status = status;
    }
  }

  return { ServerApiError: MockServerApiError, serverApiFetch: vi.fn() };
});
vi.mock("server-only", () => ({}));
// The adapter asks isGuestMode() before it fetches, and that reads a cookie.
// Outside a Next request scope `cookies()` throws E251, which the adapter would
// report as the generic error state and hide whatever the assertion was for.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dashboardResponse: DashboardApiResponse = {
  accountCount: 1,
  transactionCount: 2,
  accounts: [
    {
      id: "account-1",
      type: "debit",
      label: "Cuenta principal",
      currency: "USD",
      metadata: {},
      createdAt: "2026-07-20T10:00:00.000Z",
    },
  ],
  transactions: [
    {
      id: "transaction-1",
      accountId: "account-1",
      amount: { currency: "USD", coefficient: "19990", scale: 2 },
      metadata: {},
      createdAt: "2026-07-20T10:30:00.000Z",
    },
    {
      id: "transaction-2",
      accountId: "account-1",
      amount: { currency: "USD", coefficient: "2500", scale: 2 },
      metadata: {},
      createdAt: "2026-07-19T10:30:00.000Z",
    },
  ],
  totals: [{ currency: "USD", coefficient: "22490", scale: 2 }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Next dashboard data boundary", () => {
  it("formats coefficient and scale exactly without numeric conversion", () => {
    expect(
      formatMoneyDto({
        currency: "USD",
        coefficient: "123456789012345678901234567890",
        scale: 2,
      }),
    ).toEqual({
      currency: "USD",
      text: "$1,234,567,890,123,456,789,012,345,678.90",
    });
    expect(formatMoneyDto({ currency: "MXN", coefficient: "-19", scale: 3 })).toEqual({
      currency: "MXN",
      text: "-$0.019",
    });
  });

  it("maps API totals to an allocation and transactions to recent activity", () => {
    const state = dashboardViewToState(dashboardResponse);

    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;

    expect(state.model.balance).toEqual({ status: "unavailable", reason: "not-calculated" });
    expect(state.model.trendOrAllocation).toMatchObject({
      kind: "allocation",
      label: "Actividad neta por moneda",
    });
    expect(state.model.trendOrAllocation.summary).toContain("no representa el saldo disponible");
    expect(state.model.trendOrAllocation.values[0]).toMatchObject({
      label: "Neto registrado USD",
      value: {
        exact: dashboardResponse.totals[0],
        formatted: { currency: "USD", text: "$224.90" },
      },
    });
    expect(state.model.activity).toEqual([
      {
        id: "transaction-1",
        label: "Movimiento sin descripción",
        detail: "Cuenta principal",
        type: "income",
        date: "2026-07-20T10:30:00.000Z",
        displayDate: expect.any(String),
        value: {
          exact: dashboardResponse.transactions[0]?.amount,
          formatted: { currency: "USD", text: "$199.90" },
        },
      },
      {
        id: "transaction-2",
        label: "Movimiento sin descripción",
        detail: "Cuenta principal",
        type: "income",
        date: "2026-07-19T10:30:00.000Z",
        displayDate: expect.any(String),
        value: {
          exact: dashboardResponse.transactions[1]?.amount,
          formatted: { currency: "USD", text: "$25.00" },
        },
      },
    ]);
    expect(JSON.stringify(state.model)).not.toMatch(/card[- ]number|número de tarjeta/i);
  });

  it("returns a safe empty state for a dashboard with no records", () => {
    expect(
      dashboardViewToState({
        ...dashboardResponse,
        accountCount: 0,
        transactionCount: 0,
        accounts: [],
        transactions: [],
        totals: [],
      }).status,
    ).toBe("empty");
  });

  it("keeps the API client server-only and normalizes failures without details", async () => {
    const adapterSource = await readFile(path.join(webRoot, "lib/dashboard-adapter.ts"), "utf8");
    const moneySource = await readFile(path.join(webRoot, "lib/money.ts"), "utf8");
    expect(adapterSource.startsWith('import "server-only";')).toBe(true);
    expect(moneySource).not.toMatch(/\b(parseFloat|parseInt|BigInt|Intl|Math\.)\b/);

    const fetchMock = vi.mocked(serverApiFetch);
    fetchMock.mockRejectedValue(new Error("API_URL=http://private.internal:3001 secret"));

    await expect(loadDashboardState()).resolves.toEqual({
      status: "error",
      message: "No se pudo cargar el resumen financiero.",
    });
    expect(fetchMock).toHaveBeenCalledWith("/dashboard");
  });

  it("represents an unauthenticated dashboard as a locked state", async () => {
    vi.mocked(serverApiFetch).mockRejectedValue(new ServerApiError(401));

    await expect(loadDashboardState()).resolves.toEqual({ status: "locked" });
  });

  it("rejects malformed API data as a safe Spanish error state", async () => {
    vi.mocked(serverApiFetch).mockResolvedValue({ malformed: true });

    await expect(loadDashboardState()).resolves.toEqual({
      status: "error",
      message: "No se pudo cargar el resumen financiero.",
    });
  });
});
