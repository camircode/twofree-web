import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");
const productionFiles = [
  "app/layout.tsx",
  "app/page.tsx",
  "components/workspace-shell.tsx",
] as const;
const forbiddenFinanceMarkers =
  /\b(?:fetch|axios|XMLHttpRequest)\s*\(|API_URL|127\.0\.0\.1:3001|api:3001|packages\/ui\/test\/fixtures|syntheticFinanceExperience|FinanceExperienceModel|\b(?:pan|card[- ]?number|cardnumber|número\s+de\s+tarjeta)\b|\b(?:\d[ -]?){13,19}\b|(?:\b(?:MXN|USD|EUR|ARS|COP|CLP|BRL)\s*\$?\s*\d[\d,.]*|\$\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:MXN|USD|EUR|ARS|COP|CLP|BRL)\b)/iu;

async function readWebFile(relativePath: string): Promise<string> {
  return await readFile(path.join(webRoot, relativePath), "utf8");
}

async function readProductionSource(): Promise<string> {
  return (await Promise.all(productionFiles.map(readWebFile))).join("\n");
}

function assertNoFinanceMarkers(source: string): void {
  expect(source).not.toMatch(forbiddenFinanceMarkers);
}

describe("authenticated finance route safety boundary", () => {
  it("keeps synthetic fixtures and sensitive payloads outside the production route", async () => {
    const productionSource = await readProductionSource();

    expect(productionSource).not.toMatch(/packages\/ui\/test\/fixtures|syntheticFinanceExperience/);
    expect(productionSource).not.toMatch(/status:\s*["']ready["']/);
    expect(productionSource).not.toMatch(/FinanceExperienceModel|DashboardModel/);
    expect(productionSource).toContain("FinanceDashboard");
    expect(productionSource).toContain("loadDashboardPage");
  });

  it("rejects finance payload and request markers from route evidence", async () => {
    const routeSource = await readProductionSource();

    expect(routeSource).toContain("Inicie sesión para consultar y registrar sus movimientos");
    expect(routeSource).toContain("No pudimos consultar su espacio financiero");
    assertNoFinanceMarkers(routeSource);
    expect(routeSource).not.toMatch(
      /fixture|\b(?:coefficient|scale|amount|accountId|transactionId|currency)\b/i,
    );
  });

  it("fails closed for a controlled marker mutation", async () => {
    const productionSource = await readProductionSource();

    for (const marker of [
      'fetch("/dashboard");',
      "PAN: 4111 1111 1111 1111",
      "card-number: 4111111111111111",
      "MXN 100",
      "$100",
      "100 MXN",
    ]) {
      expect(() => assertNoFinanceMarkers(`${productionSource}\n${marker}`), marker).toThrow();
    }
  });
});
