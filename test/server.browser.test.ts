import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "@camircode/twofree-application";
import { createWebServer } from "../src/server.js";

type Account = { id: string; label: string; currency: string; type: string };
type Transaction = {
  id: string;
  accountId: string;
  amount: { currency: string; coefficient: string; scale: number };
};

let api: Server;
let web: Server;
let browser: Browser;
let page: Page;
let webUrl: string;
let apiPort: number;
let available = true;
let transactionRequests = 0;
const accounts: Account[] = [];
const transactions: Transaction[] = [];
const idempotentTransactions = new Map<string, Transaction>();

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function apiHandler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-headers": "content-type, idempotency-key",
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-origin": "*",
    });
    response.end();
    return;
  }
  if (!available) {
    json(response, 503, { error: "request_failed", message: "database details must not leak" });
    return;
  }
  const path = new URL(request.url ?? "/", "http://api.test").pathname;
  void (async () => {
    if (path === "/accounts" && request.method === "GET") return json(response, 200, { accounts });
    if (path === "/accounts" && request.method === "POST") {
      const input = await body(request);
      if (!String(input.label ?? "").trim() || !String(input.currency ?? "").trim()) {
        return json(response, 400, {
          error: "validation_failed",
          message: "Account label is required.",
        });
      }
      const account = {
        id: `account-${accounts.length + 1}`,
        label: String(input.label),
        currency: String(input.currency),
        type: String(input.type),
      };
      accounts.push(account);
      return json(response, 201, { account });
    }
    if (path === "/transactions" && request.method === "GET")
      return json(response, 200, { transactions });
    if (path === "/transactions" && request.method === "POST") {
      const input = await body(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !key) {
        return json(response, 400, {
          error: "validation_failed",
          message: "Idempotency-Key header is required",
        });
      }
      transactionRequests += 1;
      const existing = idempotentTransactions.get(key);
      if (existing) return json(response, 201, { transaction: existing });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const transaction = {
        id: `transaction-${transactions.length + 1}`,
        accountId: String(input.accountId),
        amount: input.amount as Transaction["amount"],
      };
      transactions.push(transaction);
      idempotentTransactions.set(key, transaction);
      return json(response, 201, { transaction });
    }
    if (path === "/dashboard" && request.method === "GET")
      return json(response, 200, {
        accountCount: accounts.length,
        transactionCount: transactions.length,
        accounts,
        transactions,
        totals: transactions.length ? [{ currency: "MXN", coefficient: "1999", scale: 2 }] : [],
      });
    if (path === "/export" && request.method === "GET")
      return json(response, 200, { version: 1, accounts, transactions });
    if (path === "/import" && request.method === "POST")
      return json(response, 200, { imported: true });
    return json(response, 404, { error: "not_found" });
  })().catch(() => json(response, 500, { error: "request_failed" }));
}

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("web product in Chromium", () => {
  beforeAll(async () => {
    api = createServer(apiHandler);
    apiPort = await listen(api);
    const config = loadRuntimeConfig({
      APP_PROFILE: "ci",
      BETTER_AUTH_SECRET: "slice-one-test-secret-with-more-than-32-bytes",
      WEB_HOST: "127.0.0.1",
      WEB_PORT: "3000",
    });
    web = createWebServer(config, `http://127.0.0.1:${apiPort}`);
    const webPort = await listen(web);
    webUrl = `http://127.0.0.1:${webPort}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
    await browser.close();
    await close(api);
    await close(web);
  });

  it("reloads every route, exposes empty state and validates accessible forms", async () => {
    for (const [route, heading] of [
      ["/dashboard", "Dashboard"],
      ["/accounts", "Accounts"],
      ["/transactions", "Transactions"],
      ["/portability", "Portability"],
    ]) {
      await page.goto(`${webUrl}${route}`);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe(route);
    }

    await page.goto(`${webUrl}/accounts`);
    await page.getByRole("heading", { name: "Accounts", exact: true }).waitFor();
    await page.getByText("No accounts yet. Create your first account to begin.").waitFor();
    await page.getByLabel("Account label").fill("");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Account label is required.").waitFor();
    expect(await page.getByLabel("Account label").getAttribute("aria-invalid")).toBe("true");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).toBe(
      "account-label",
    );

    await page.getByLabel("Account label").fill("Daily spending");
    await page.getByLabel("Currency").fill("MXN");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Daily spending").waitFor();

    await page.getByRole("link", { name: "Transactions" }).click();
    await page.getByRole("heading", { name: "Transactions", exact: true }).waitFor();
    await page.getByLabel("Amount coefficient").fill("not-an-integer");
    await page.getByRole("button", { name: "Create transaction" }).click();
    await page.getByText("Amount coefficient must be an integer.").waitFor();
    expect(await page.getByLabel("Amount coefficient").getAttribute("aria-invalid")).toBe("true");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).toBe(
      "amount-coefficient",
    );

    await page.getByLabel("Account").selectOption("account-1");
    await page.getByLabel("Amount coefficient").fill("1999");
    await page.getByLabel("Amount scale").fill("2");
    const requestsBefore = transactionRequests;
    const submit = page.getByRole("button", { name: "Create transaction" });
    await submit.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.getByText("19.99 MXN").waitFor();
    expect(transactionRequests).toBe(requestsBefore + 1);

    await page.getByLabel("Amount coefficient").fill("-1999");
    await page.getByRole("button", { name: "Create transaction" }).click();
    await page.getByText("-19.99 MXN").waitFor();

    const replay = await page.evaluate(async (url) => {
      const payload = JSON.stringify({
        accountId: "account-1",
        amount: { currency: "MXN", coefficient: "1999", scale: 2 },
      });
      const headers = {
        "content-type": "application/json",
        "idempotency-key": "browser-replay",
      };
      const first = await fetch(`${url}/transactions`, { method: "POST", headers, body: payload });
      const second = await fetch(`${url}/transactions`, { method: "POST", headers, body: payload });
      return [await first.json(), await second.json()];
    }, `http://127.0.0.1:${apiPort}`);
    expect(replay[0].transaction.id).toBe(replay[1].transaction.id);
    expect(transactions).toHaveLength(3);
  });

  it("proves portability, restart readback, retry, and safe API failures", async () => {
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    expect(await page.getByText("1 account").textContent()).toContain("1 account");

    await page.getByRole("link", { name: "Portability", exact: true }).click();
    await page.getByRole("button", { name: "Export data" }).click();
    await page.waitForFunction(() =>
      (document.querySelector("#exported-data") as HTMLTextAreaElement | null)?.value.includes(
        '"accounts"',
      ),
    );
    expect(await page.getByLabel("Exported data").inputValue()).toContain('"accounts"');

    const exported = await page.getByLabel("Exported data").inputValue();
    await page.getByLabel("Versioned JSON").fill(exported);
    await page.getByRole("button", { name: "Import data" }).click();
    await page.getByText("Import complete.").waitFor();

    await close(api);
    api = createServer(apiHandler);
    expect(await listen(api, apiPort)).toBe(apiPort);
    await page.goto(`${webUrl}/transactions`);
    await page.locator("td").filter({ hasText: "19.99 MXN" }).first().waitFor();

    available = false;
    await page.getByRole("link", { name: "Dashboard" }).click();
    expect(await page.getByRole("alert").textContent()).toContain(
      "The API is unavailable. Try again.",
    );
    expect(await page.getByRole("alert").textContent()).not.toContain("database details");
    available = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByText("3 transactions").waitFor();
  });
});
