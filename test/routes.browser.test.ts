import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type ConsoleMessage, type Page, type Request } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePath } from "../lib/base-path";

const webRoot = path.resolve(import.meta.dirname, "..");
const routeBaselineDirectory = path.join(
  webRoot,
  "test/visual-baselines/mobile-first-finance-experience/route",
);
const routeArtifactDirectory = path.join(
  webRoot,
  "artifacts/visual/mobile-first-finance-experience/route",
);

const routeVariants = [
  { name: "mobile-light-motion", width: 390, height: 844, theme: "light", reduced: false },
  { name: "mobile-light-reduced", width: 390, height: 844, theme: "light", reduced: true },
  { name: "mobile-dark-motion", width: 390, height: 844, theme: "dark", reduced: false },
  { name: "mobile-dark-reduced", width: 390, height: 844, theme: "dark", reduced: true },
  { name: "desktop-light-motion", width: 1280, height: 900, theme: "light", reduced: false },
  { name: "desktop-light-reduced", width: 1280, height: 900, theme: "light", reduced: true },
  { name: "desktop-dark-motion", width: 1280, height: 900, theme: "dark", reduced: false },
  { name: "desktop-dark-reduced", width: 1280, height: 900, theme: "dark", reduced: true },
] as const;

const forbiddenRequestMarkers =
  /(?:\/dashboard\b|API_URL|fixture|syntheticFinanceExperience|FinanceExperienceModel|DashboardModel|(?:currency|amount|coefficient|accountId|transactionId)|(?:MXN|USD|EUR|ARS|COP|CLP|BRL)\s*\$?\s*\d|\$\s*\d|\b(?:\d[ -]?){13,19}\b)/iu;
const forbiddenHtmlMarkers =
  /(?:API_URL|127\.0\.0\.1:3001|api:3001|packages\/ui\/test\/fixtures|syntheticFinanceExperience|FinanceExperienceModel|DashboardModel|\b(?:coefficient|accountId|transactionId)\b|\b(?:MXN|USD|EUR|ARS|COP|CLP|BRL)\s*\$?\s*\d|\$\s*(?:\d{3,}|\d{1,2}[.,]\d{2})|\b(?:\d[ -]?){13,19}\b)/iu;

let next: ChildProcess;
let authApi: Server;
let browser: Browser;
let page: Page;
let webUrl: string;
let lastAccount: Record<string, unknown> | undefined;
let lastCreditProfile: Record<string, unknown> | undefined;
let lastNotificationRule: Record<string, unknown> | undefined;

async function unusedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a listening server");
  return address.port;
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

type RouteResult = Readonly<{
  consoleErrors: string[];
  html: string;
  pageErrors: string[];
  requests: string[];
}>;

async function prepareRoute(variant: (typeof routeVariants)[number]): Promise<RouteResult> {
  await page.setViewportSize({ width: variant.width, height: variant.height });
  await page.goto(`${webUrl}/health`, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme) => {
    window.localStorage.setItem("2free-theme", theme);
  }, variant.theme);
  await page.emulateMedia({ reducedMotion: variant.reduced ? "reduce" : "no-preference" });

  const requests: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestListener = (request: Request) => {
    requests.push(`${request.url()} ${request.postData() ?? ""}`);
  };
  const pageErrorListener = (error: Error) => pageErrors.push(error.message);
  const consoleListener = (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };

  // This listener MUST be registered before the actual route navigation.
  page.on("request", requestListener);
  page.on("pageerror", pageErrorListener);
  page.on("console", consoleListener);
  try {
    const response = await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });
    if (!response) throw new Error("The actual route returned no navigation response");
    const html = await response.text();
    await page.waitForFunction(
      (expectedTheme) => document.documentElement.dataset.theme === expectedTheme,
      variant.theme,
    );
    await page.waitForSelector('[data-motion-settled="true"]');
    await page.waitForSelector('[data-status-tone="danger"]');
    await page.waitForFunction(
      (expectedMotion) =>
        document.querySelector(
          `[data-motion-enhancement][data-motion-mode="${expectedMotion}"]`,
        ) !== null,
      variant.reduced ? "reduced" : "enhanced",
    );
    if (!variant.reduced) await page.waitForTimeout(700);
    await page.evaluate(async () => {
      const freezeStyle = document.createElement("style");
      freezeStyle.dataset.routeCaptureFreeze = "true";
      freezeStyle.textContent =
        "*,*::before,*::after{animation:none!important;transition:none!important;}";
      document.head.append(freezeStyle);
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
              }),
        ),
      );
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const closeAuth = page.getByRole("button", { name: "Cerrar acceso" });
    await closeAuth
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => closeAuth.click())
      .catch(() => undefined);
    return { consoleErrors, html, pageErrors, requests };
  } finally {
    page.off("request", requestListener);
    page.off("pageerror", pageErrorListener);
    page.off("console", consoleListener);
  }
}

function assertRouteSafety(result: RouteResult): void {
  expect(result.html).toContain('data-workspace-shell="true"');
  expect(result.html).toContain('data-route-surface="route"');
  expect(result.html).toContain("No se pudo cargar el resumen financiero.");
  expect(result.html).not.toMatch(forbiddenHtmlMarkers);
  expect(result.requests.join("\n")).not.toMatch(forbiddenRequestMarkers);
  expect(result.pageErrors).toEqual([]);
  expect(result.consoleErrors).toEqual([]);
}

async function assertRouteComposition(variant: (typeof routeVariants)[number]): Promise<void> {
  expect(await page.locator('[data-workspace-shell="true"]').count()).toBe(1);
  expect(await page.locator('[data-route-surface="route"]:visible').count()).toBe(1);
  expect(await page.locator("main").count()).toBe(1);
  expect(await page.locator('nav[aria-label="Navegación principal"]').count()).toBe(1);
  expect(await page.locator('nav[aria-label="Navegación móvil"]').count()).toBe(1);
  expect(await page.locator('[data-status-tone="danger"]:visible').count()).toBe(1);
  expect(await page.locator('[data-status-tone="danger"]:visible').textContent()).toContain(
    "No se pudo cargar el resumen financiero.",
  );
  expect(await page.locator("table").count()).toBe(0);

  const layout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.htmlScrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.innerWidth);

  const desktopNavigationDisplay = await page
    .locator(".ui-shell__header-navigation")
    .evaluate((element) => getComputedStyle(element).display);
  const mobileNavigationDisplay = await page
    .locator(".ui-shell__mobile-navigation")
    .evaluate((element) => getComputedStyle(element).display);
  expect(
    await page
      .locator(".ui-shell__header")
      .evaluate((element) => getComputedStyle(element).viewTransitionName),
  ).toBe("app-header");
  expect(
    await page
      .locator(".ui-shell__mobile-navigation")
      .evaluate((element) => getComputedStyle(element).viewTransitionName),
  ).toBe("app-mobile-navigation");
  expect(await page.locator("aside").count()).toBe(0);

  if (variant.width === 390) {
    expect(desktopNavigationDisplay).toBe("none");
    expect(mobileNavigationDisplay).toBe("grid");
    const mobileItems = await page
      .locator(".ui-shell__mobile-navigation > *")
      .evaluateAll((items) =>
        items.map((item) => ({
          fontSize: getComputedStyle(item.querySelector(".ui-shell__navigation-label")!).fontSize,
          width: item.getBoundingClientRect().width,
        })),
      );
    expect(new Set(mobileItems.map((item) => item.fontSize)).size).toBe(1);
    expect(Math.abs(mobileItems[0]!.width / 3 - mobileItems[1]!.width)).toBeLessThan(1);
  } else {
    expect(desktopNavigationDisplay).toBe("flex");
    expect(mobileNavigationDisplay).toBe("none");
  }
}

async function routeSignature(): Promise<string> {
  return await page.locator('[data-workspace-shell="true"]').evaluate((root) => {
    const headings = [...root.querySelectorAll("h1, h2, h3")].map((heading) =>
      heading.textContent?.replace(/\s+/g, " ").trim(),
    );
    const dataAttributes = [...root.querySelectorAll("*")]
      .flatMap((element) =>
        [...element.attributes]
          .filter(({ name }) => /^(?:data-(?:finance|route|workspace|motion|state))/u.test(name))
          .map(({ name, value }) => `${name}=${value}`),
      )
      .sort();
    return JSON.stringify({
      dataAttributes: dataAttributes
        .map((attribute) =>
          attribute
            .replace(/data-motion-mode=(?:enhanced|reduced)/u, "data-motion-mode=settled")
            .replace(/data-motion=(?:enhanced|reduced)/u, "data-motion=settled"),
        )
        .sort(),
      headings,
      text: root.textContent?.replace(/\s+/g, " ").trim(),
    });
  });
}

async function assertNonColorStatus(): Promise<void> {
  const state = page.locator('[data-status-tone="danger"]:visible');
  expect(await state.getAttribute("role")).toBe("alert");
  expect(await state.textContent()).toMatch(/[\p{L}]{2,}/u);
  expect(await state.locator('[data-status-marker="true"]').count()).toBe(1);
}

function pngDimensions(buffer: Buffer): Readonly<{ width: number; height: number }> {
  expect(buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))).toBe(true);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function mismatchedPixelRatio(actual: Buffer, expected: Buffer): Promise<number> {
  return await page.evaluate(
    async ({ actualBase64, expectedBase64 }) => {
      async function pixels(encoded: string) {
        const response = await fetch(`data:image/png;base64,${encoded}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context is unavailable");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      }

      const [actualPixels, expectedPixels] = await Promise.all([
        pixels(actualBase64),
        pixels(expectedBase64),
      ]);
      if (actualPixels.length !== expectedPixels.length) return 1;
      let mismatched = 0;
      for (let offset = 0; offset < actualPixels.length; offset += 4) {
        if (
          actualPixels[offset] !== expectedPixels[offset] ||
          actualPixels[offset + 1] !== expectedPixels[offset + 1] ||
          actualPixels[offset + 2] !== expectedPixels[offset + 2] ||
          actualPixels[offset + 3] !== expectedPixels[offset + 3]
        ) {
          mismatched += 1;
        }
      }
      return mismatched / (actualPixels.length / 4);
    },
    { actualBase64: actual.toString("base64"), expectedBase64: expected.toString("base64") },
  );
}

async function captureRoute(variant: (typeof routeVariants)[number]): Promise<void> {
  const result = await prepareRoute(variant);
  assertRouteSafety(result);
  await assertRouteComposition(variant);
  await assertNonColorStatus();
  const signature = await routeSignature();
  const parityKey = `${variant.width}-${variant.theme}`;
  if (variant.reduced) {
    expect(signature).toBe(finalStateSignatures.get(parityKey));
  } else {
    finalStateSignatures.set(parityKey, signature);
  }

  const artifactPath = path.join(routeArtifactDirectory, `route-${variant.name}.png`);
  const baselinePath = path.join(routeBaselineDirectory, `route-${variant.name}.png`);
  await mkdir(routeArtifactDirectory, { recursive: true });
  await mkdir(routeBaselineDirectory, { recursive: true });
  const screenshot = await page.screenshot({ path: artifactPath, fullPage: false });
  expect(pngDimensions(screenshot)).toEqual({ width: variant.width, height: variant.height });

  if (process.env.VISUAL_UPDATE === "1") {
    await writeFile(baselinePath, screenshot);
    return;
  }

  const baseline = await readFile(baselinePath);
  expect(pngDimensions(baseline)).toEqual({ width: variant.width, height: variant.height });
  expect(await mismatchedPixelRatio(screenshot, baseline)).toBeLessThanOrEqual(0.001);
}

const finalStateSignatures = new Map<string, string>();

describe("Next workspace in Chromium", () => {
  beforeAll(async () => {
    authApi = createServer(async (request, response) => {
      const origin = request.headers.origin ?? "http://127.0.0.1";
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-credentials", "true");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/api/auth/get-session") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ user: null }));
        return;
      }
      if (request.url === "/accounts" && request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        for await (const chunk of request) body += chunk;
        lastAccount = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ account: { id: "account-1", ...lastAccount } }));
        return;
      }
      if (request.url === "/credit-cards" && request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        for await (const chunk of request) body += chunk;
        lastCreditProfile = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ record: { id: "credit-1", value: lastCreditProfile } }));
        return;
      }
      if (request.url === "/notification-rules" && request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        for await (const chunk of request) body += chunk;
        lastNotificationRule = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ record: { id: "rule-1", value: lastNotificationRule } }));
        return;
      }
      if (
        request.method === "GET" &&
        ["/credit-cards", "/charge-cards", "/debit-profiles", "/yield-accounts"].includes(
          request.url ?? "",
        )
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ records: [] }));
        return;
      }
      if (request.url === "/accounts") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ accounts: [] }));
        return;
      }
      if (request.url === "/transactions") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ transactions: [] }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const authApiPort = await listen(authApi);
    const port = await unusedPort();
    next = spawn(
      path.join(webRoot, "node_modules/.bin/next"),
      ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          API_URL: `http://127.0.0.1:${authApiPort}`,
          APP_PROFILE: "ci",
          NEXT_DIST_DIR: ".next-test-routes",
          NEXT_PUBLIC_API_URL: `http://127.0.0.1:${authApiPort}`,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: "ignore",
      },
    );
    webUrl = `http://127.0.0.1:${port}${basePath}`;
    await waitForNext(`${webUrl}/`);
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page?.close();
  });

  afterAll(async () => {
    await browser?.close();
    next?.kill("SIGTERM");
    await close(authApi);
  });

  it("records requests before navigating to the actual route and proves the safe public boundary", async () => {
    const result = await prepareRoute(routeVariants[0]);
    assertRouteSafety(result);
    await assertRouteComposition(routeVariants[0]);
    expect(result.html).toContain('<html lang="es"');
    expect(result.html).not.toContain("Próximamente");
    expect(result.html).not.toMatch(/(?:fixture|payload|card[- ]?number)/i);
  }, 120_000);

  it("opens the login dialog from the access control", async () => {
    await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-workspace-shell="true"]').waitFor();
    const closeAccess = page.getByRole("button", { name: "Cerrar acceso" });
    await page.evaluate(() => window.dispatchEvent(new Event("2free:open-auth")));
    await closeAccess.waitFor();
    expect(await page.locator('[role="dialog"]').textContent()).toContain("Vuelva a sus finanzas");
    await closeAccess.click();
  }, 120_000);

  it("enters and leaves the recruiter demo without creating an account", async () => {
    const requests: string[] = [];
    const listener = (request: Request) => requests.push(request.url());
    page.on("request", listener);
    try {
      await page.goto(`${webUrl}/guest`, { waitUntil: "domcontentloaded" });
      await page.locator("h1:visible", { hasText: "Hola, invitado" }).waitFor();
      expect(await page.getByLabel("Modo invitado activo").textContent()).toContain("Demo");
      expect(await page.getByRole("dialog").count()).toBe(0);
      expect(await page.getByText("Supermercado").count()).toBeGreaterThan(0);
      expect(requests.some((url) => url.includes("/api/auth/get-session"))).toBe(false);

      await page.goto(`${webUrl}/transacciones`, { waitUntil: "domcontentloaded" });
      await page.getByText("Filtrar historial").click();
      expect(
        await page.locator("label:visible", { hasText: "Cuenta" }).locator("select").count(),
      ).toBe(1);
      expect(
        await page.locator("label:visible", { hasText: "Monto mínimo" }).locator("input").count(),
      ).toBe(1);
      expect(
        await page.locator("label:visible", { hasText: "Periodo" }).locator("select").count(),
      ).toBe(1);
      await page.locator("button:visible", { hasText: "Editar" }).first().click();
      await page.locator("dialog:visible").waitFor();
      await page.locator('dialog:visible button[aria-label="Cerrar"]').click();

      await page.goto(`${webUrl}/cuentas`, { waitUntil: "domcontentloaded" });
      await page.locator("button:visible", { hasText: "Eliminar" }).first().click();
      expect(await page.locator("dialog:visible").textContent()).toContain(
        "Elimine primero las transacciones asociadas",
      );
      await page.locator('dialog:visible button[aria-label="Cerrar"]').click();

      await page.getByRole("link", { name: "Salir del modo demo" }).click();
      await page.getByRole("button", { name: "Cerrar acceso" }).waitFor();
    } finally {
      page.off("request", listener);
    }
  }, 120_000);

  it("keeps the route theme, motion, landmarks, and 404 behavior deterministic", async () => {
    const result = await prepareRoute(routeVariants[4]);
    assertRouteSafety(result);
    await assertRouteComposition(routeVariants[4]);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
    expect(
      await page.locator('[data-motion-enhancement][data-motion-mode="enhanced"]').count(),
    ).toBe(1);

    const darkSurface = await page
      .locator(".ui-shell")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByRole("button", { name: "Usar modo oscuro" }).click();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    expect(
      await page
        .locator(".ui-shell")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe(darkSurface);

    const unknown = await fetch(`${webUrl}/ruta-inexistente`);
    const unknownHtml = await unknown.text();
    expect(unknown.status).toBe(404);
    expect(unknownHtml).toContain("Página no encontrada");
    expect((await fetch(`${webUrl}/inversiones`)).status).toBe(404);
    expect((await fetch(`${webUrl}/inversiones/mercado`)).status).toBe(404);

    const health = await fetch(`${webUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ready" });
  }, 120_000);

  it("keeps one continuous navigation surface at tablet width", async () => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ui-shell__mobile-navigation");
    const closeAuth = page.getByRole("button", { name: "Cerrar acceso" });
    await closeAuth
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => closeAuth.click())
      .catch(() => undefined);
    expect(
      await page
        .locator(".ui-shell__header-navigation")
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe("none");
    expect(
      await page
        .locator(".ui-shell__mobile-navigation")
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe("grid");
    expect(await page.locator(".ui-shell__mobile-navigation").count()).toBe(1);
    await page.locator(".ui-shell__mobile-navigation").getByLabel("Abrir más secciones").click();
    expect(await page.getByRole("link", { name: "Inversiones" }).count()).toBe(0);
    expect(await page.getByRole("link", { name: "Tarjetas" }).count()).toBe(0);
  }, 120_000);

  it("keeps the mobile navbar present while route content settles", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });
    const closeAuth = page.getByRole("button", { name: "Cerrar acceso" });
    await closeAuth
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => closeAuth.click())
      .catch(() => undefined);

    const mobileNavigation = page.locator(".ui-shell__mobile-navigation");
    expect(
      await mobileNavigation.evaluate((element) => getComputedStyle(element).viewTransitionName),
    ).toBe("app-mobile-navigation");

    await Promise.all([
      page.waitForURL(`${webUrl}/transacciones`),
      mobileNavigation.getByRole("link", { name: "Actividad" }).click(),
    ]);

    await mobileNavigation.waitFor({ state: "visible" });
    expect(await mobileNavigation.evaluate((element) => getComputedStyle(element).opacity)).toBe(
      "1",
    );
    await page.waitForTimeout(700);
    expect(
      await page.locator(".ui-shell__main > * > *").evaluateAll((elements) =>
        elements.every((element) => {
          const style = getComputedStyle(element);
          return style.opacity === "1" && style.transform === "none" && style.filter === "none";
        }),
      ),
    ).toBe(true);
  }, 120_000);

  it("opens account creation from Cuentas and keeps transaction recovery in Transacciones", async () => {
    await page.goto(`${webUrl}/cuentas`, { waitUntil: "domcontentloaded" });
    const closeAuth = page.getByRole("button", { name: "Cerrar acceso" });
    await closeAuth
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => closeAuth.click())
      .catch(() => undefined);
    await page.getByRole("button", { name: "Crear una cuenta" }).click();
    const accountDialog = page.getByRole("dialog", { name: "Crear una cuenta" });
    await accountDialog.waitFor();
    expect(await accountDialog.count()).toBe(1);
    expect(await accountDialog.getByText("Paso 1 de 4").count()).toBe(1);
    expect(await accountDialog.getByRole("button", { name: /Tarjeta de crédito/ }).count()).toBe(1);
    expect(await accountDialog.getByLabel("Identificador de cuenta").count()).toBe(0);
    await page.waitForTimeout(250);
    const dialogBox = await accountDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(
      Math.abs((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2),
    ).toBeLessThan(2);
    await accountDialog.getByRole("button", { name: /Tarjeta de crédito/ }).click();
    await accountDialog.getByRole("button", { name: "Continuar" }).click();
    await accountDialog.getByLabel("Nombre").fill("Tarjeta principal");
    await accountDialog.getByRole("button", { name: "Continuar" }).click();
    expect(await accountDialog.getByLabel("CAT anual (%)").count()).toBe(1);
    expect(await accountDialog.getByLabel("Línea de crédito").count()).toBe(1);
    expect(
      Math.abs((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) / 2 - (viewport?.height ?? 0) / 2),
    ).toBeLessThan(2);
    const closeButtonBox = await accountDialog
      .getByRole("button", { name: "Cerrar" })
      .boundingBox();
    const closeIconBox = await accountDialog
      .getByRole("button", { name: "Cerrar" })
      .locator("svg")
      .boundingBox();
    expect(
      Math.abs(
        (closeButtonBox?.x ?? 0) +
          (closeButtonBox?.width ?? 0) / 2 -
          ((closeIconBox?.x ?? 0) + (closeIconBox?.width ?? 0) / 2),
      ),
    ).toBeLessThan(2);
    await accountDialog.getByLabel("Día de corte").fill("15");
    await accountDialog.getByLabel("Día límite de pago").fill("25");
    await accountDialog.getByLabel("Anualidad").fill("1000.00");
    await accountDialog.getByLabel("CAT anual (%)").fill("60");
    await accountDialog.getByLabel("Tasa de interés anual (%)").fill("45");
    await accountDialog.getByLabel("Línea de crédito").fill("10000.00");
    await accountDialog.getByLabel("Vigencia de la línea actual").fill("2026-07-01");
    await accountDialog.getByRole("button", { name: "Continuar" }).click();
    await accountDialog.getByRole("button", { name: "Crear cuenta" }).dispatchEvent("click");
    await accountDialog.waitFor({ state: "hidden" });
    expect(lastAccount).toEqual(expect.objectContaining({ type: "revolving-credit" }));
    expect(lastCreditProfile).toEqual(
      expect.objectContaining({
        accountId: "account-1",
        catAnnualPercent: "60",
        annualInterestPercent: "45",
        minimumUseWarningDays: 3,
      }),
    );
    expect(lastNotificationRule).toEqual(
      expect.objectContaining({ source: "credit-card:account-1", condition: "card" }),
    );

    await page.goto(`${webUrl}/transacciones`, { waitUntil: "domcontentloaded" });
    const recovery = page.getByRole("link", { name: "Crear cuenta para registrar movimientos" });
    expect(await recovery.getAttribute("href")).toBe(`${basePath}/cuentas?crear=1`);
  }, 120_000);

  it.each(routeVariants)(
    "captures the settled actual route $name",
    async (variant) => {
      await captureRoute(variant);
    },
    120_000,
  );
});
