import "server-only";

import type { DashboardView } from "@camircode/twofree-application";
import type { DashboardModel, DashboardState } from "@camircode/twofree-ui";
import type { AccountOption } from "@camircode/twofree-ui/portfolio";

import { dashboardErrorMessage } from "./errors";
import { guestDashboard } from "./guest-data";
import { isGuestMode } from "./guest-mode";
import { formatMoneyDto, toDashboardMoney } from "./money";
import { ServerApiError, serverApiFetch } from "./server-api";

export type DashboardApiResponse = DashboardView;

export type DashboardPageData = Readonly<{
  accounts: readonly AccountOption[];
  state: DashboardState;
}>;

const unavailableBalance = {
  status: "unavailable",
  reason: "not-calculated",
} as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMetadata(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isMoneyDto(value: unknown): value is DashboardApiResponse["totals"][number] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.currency) &&
    typeof value.coefficient === "string" &&
    /^-?(?:0|[1-9]\d*)$/.test(value.coefficient) &&
    typeof value.scale === "number" &&
    Number.isSafeInteger(value.scale) &&
    value.scale >= 0
  );
}

function isAccount(value: unknown): value is DashboardApiResponse["accounts"][number] {
  if (!isRecord(value)) return false;
  const isKnownType =
    value.type === "debit" ||
    value.type === "yield" ||
    value.type === "revolving-credit" ||
    value.type === "charge-card";
  const isCredit = value.type === "revolving-credit" || value.type === "charge-card";

  return (
    isNonEmptyString(value.id) &&
    isKnownType &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.currency) &&
    isMetadata(value.metadata) &&
    isNonEmptyString(value.createdAt) &&
    (!isCredit || isMoneyDto(value.statementBalance))
  );
}

function isTransaction(value: unknown): value is DashboardApiResponse["transactions"][number] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.accountId) &&
    isMoneyDto(value.amount) &&
    isMetadata(value.metadata) &&
    isNonEmptyString(value.createdAt)
  );
}

function isDashboardApiResponse(value: unknown): value is DashboardApiResponse {
  if (!isRecord(value)) return false;
  if (
    typeof value.accountCount !== "number" ||
    !Number.isSafeInteger(value.accountCount) ||
    value.accountCount < 0 ||
    typeof value.transactionCount !== "number" ||
    !Number.isSafeInteger(value.transactionCount) ||
    value.transactionCount < 0 ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.transactions) ||
    !Array.isArray(value.totals)
  ) {
    return false;
  }

  return (
    value.accountCount === value.accounts.length &&
    value.transactionCount >= value.transactions.length &&
    value.accounts.every(isAccount) &&
    value.transactions.every(isTransaction) &&
    value.totals.every(isMoneyDto)
  );
}

export function dashboardViewToModel(data: DashboardApiResponse): DashboardModel {
  const accountById = new Map(data.accounts.map((account) => [account.id, account.label]));

  return {
    balance: unavailableBalance,
    trendOrAllocation: {
      kind: "allocation",
      label: "Actividad neta por moneda",
      summary:
        "Suma de los ingresos y gastos registrados; no representa el saldo disponible de sus cuentas.",
      values: data.totals.map((total) => ({
        label: `Neto registrado ${total.currency}`,
        value: toDashboardMoney(total),
      })),
    },
    activity: data.transactions.map((transaction) => {
      const description = transaction.metadata.description?.trim();
      const category = transaction.metadata.category?.trim();
      const accountLabel = accountById.get(transaction.accountId) ?? "Cuenta no disponible";
      const detail = [category && category !== description ? category : undefined, accountLabel]
        .filter(Boolean)
        .join(" · ");
      const type =
        transaction.metadata.type === "expense" ||
        (transaction.metadata.type !== "income" && transaction.amount.coefficient.startsWith("-"))
          ? "expense"
          : "income";

      return {
        id: transaction.id,
        label: description || category || "Movimiento sin descripción",
        detail,
        type,
        date: transaction.createdAt,
        displayDate: new Date(transaction.createdAt).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        }),
        value: toDashboardMoney(transaction.amount),
      };
    }),
  };
}

export function dashboardViewToState(data: DashboardApiResponse): DashboardState {
  if (data.accountCount === 0 && data.transactionCount === 0) {
    return { status: "empty" };
  }

  return { status: "ready", model: dashboardViewToModel(data) };
}

export async function loadDashboardPage(): Promise<DashboardPageData> {
  if (await isGuestMode()) {
    const state = dashboardViewToState(guestDashboard);
    return {
      accounts: guestDashboard.accounts.map(({ id, label, currency }) => ({ id, label, currency })),
      state:
        state.status === "ready"
          ? {
              ...state,
              model: {
                ...state.model,
                balance: toDashboardMoney({
                  currency: "MXN",
                  coefficient: "1824000",
                  scale: 2,
                }),
              },
            }
          : state,
    };
  }
  try {
    const data = await serverApiFetch<unknown>("/dashboard");
    if (!isDashboardApiResponse(data)) throw new Error("Invalid dashboard response");
    return {
      accounts: data.accounts.map(({ id, label, currency }) => ({ id, label, currency })),
      state: dashboardViewToState(data),
    };
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 401) {
      return { accounts: [], state: { status: "locked" } };
    }
    return { accounts: [], state: { status: "error", message: dashboardErrorMessage(error) } };
  }
}

export async function loadDashboardState(): Promise<DashboardState> {
  return (await loadDashboardPage()).state;
}

export { formatMoneyDto };
