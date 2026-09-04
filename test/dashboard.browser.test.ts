import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePath } from "../lib/base-path";

const webRoot = path.resolve(import.meta.dirname, "..");
let api: Server;
let next: ChildProcess;
let browser: Browser;
let page: Page;
let apiUrl: string;
let webUrl: string;
let dashboardRequests = 0;

function sendDashboard(response: import("node:http").ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      accountCount: 1,
      transactionCount: 1,
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
      ],
      totals: [{ currency: "USD", coefficient: "19990", scale: 2 }],
    }),
  );
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitForNext(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status >= 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next did not start at ${url}: ${String(lastError)}`);
}

describe("Next dashboard in Chromium", () => {
  beforeAll(async () => {
    api = createServer((request, response) => {
      if (request.url === "/dashboard" && request.method === "GET") {
        dashboardRequests += 1;
        sendDashboard(response);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const apiPort = await listen(api);
    apiUrl = `http://127.0.0.1:${apiPort}`;

    const webPort = await unusedPort();
    webUrl = `http://127.0.0.1:${webPort}${basePath}`;
    next = spawn(
      path.join(webRoot, "node_modules/.bin/next"),
      ["dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          API_URL: apiUrl,
          APP_PROFILE: "ci",
          NEXT_DIST_DIR: ".next-test-dashboard",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: "ignore",
      },
    );
    await waitForNext(webUrl);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 120_000);

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    next?.kill("SIGTERM");
    await close(api);
  });

  it("renders API-backed SSR data without exposing infrastructure details", async () => {
    const response = await fetch(`${webUrl}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-workspace-shell="true"');
    expect(html).toContain("Neto registrado USD");
    expect(html).toContain("$199.90");
    expect(html).toContain("USD");
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain(apiUrl);
    expect(html).not.toContain("API_URL");
    expect(html).not.toMatch(/card[- ]number|número de tarjeta/i);
    expect(dashboardRequests).toBe(2);
  });
});
