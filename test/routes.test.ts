import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readWebFile(relativePath: string): Promise<string> {
  return await readFile(path.join(webRoot, relativePath), "utf8");
}

describe("Next shell and route contract", () => {
  it("defines only the exact Spanish workspace route set", async () => {
    const routes = new Map([
      ["/", "app/page.tsx"],
      ["/cuentas", "app/cuentas/page.tsx"],
      ["/transacciones", "app/transacciones/page.tsx"],
      ["/presupuesto", "app/presupuesto/page.tsx"],
      ["/compartidos", "app/compartidos/page.tsx"],
      ["/alertas", "app/alertas/page.tsx"],
      ["/ajustes", "app/ajustes/page.tsx"],
      ["/portabilidad", "app/portabilidad/page.tsx"],
    ]);

    for (const [route, file] of routes) {
      const source = await readWebFile(file);
      expect(source, `${route} should be a server page`).not.toMatch(/^"use client"/);
      expect(source).toContain('export const dynamic = "force-dynamic";');
      expect(source).toContain('data-route-surface="route"');
      expect(source).toContain("data-route-page");
      if (route === "/") {
        expect(source).toContain("FinanceDashboard");
        expect(source).toContain("loadDashboardPage");
        expect(source).toContain("OpenAuthButton");
      }
    }

    const notFound = await readWebFile("app/not-found.tsx");
    expect(notFound).toContain("Página no encontrada");
    expect(notFound).toContain("Volver al inicio");
  });

  it("keeps client islands and server-only boundaries explicit", async () => {
    const workspaceShell = await readWebFile("components/workspace-shell.tsx");
    const motionEnhancement = await readWebFile("components/motion-enhancement.tsx");
    const errorBoundary = await readWebFile("app/error.tsx");
    const layout = await readWebFile("app/layout.tsx");
    const healthRoute = await readWebFile("app/health/route.ts");

    expect(workspaceShell.startsWith('"use client";')).toBe(true);
    expect(workspaceShell).toContain('from "@camircode/twofree-ui"');
    expect(workspaceShell).toContain("AppShell");
    expect(workspaceShell).toContain("usePathname");
    expect(motionEnhancement.startsWith('"use client";')).toBe(true);
    expect(motionEnhancement).toContain("getMotionCapabilities");
    expect(motionEnhancement).toContain("data-motion={motionMode}");
    expect(errorBoundary.startsWith('"use client";')).toBe(true);
    expect(layout).toContain('import "@camircode/twofree-ui/styles.css";');
    expect(layout).toContain(
      'import logo from "@camircode/twofree-ui/assets/2free-con-fondi.svg";',
    );
    expect(layout).toContain('data-route-root="workspace"');
    expect(healthRoute).not.toMatch(/\b(window|document|localStorage|navigator)\b/);
  });

  it("keeps guest access isolated from authenticated API ownership", async () => {
    const guestRoute = await readWebFile("app/guest/route.ts");
    const guestMode = await readWebFile("lib/guest-mode.ts");
    const transactionRegistration = await readWebFile("components/transaction-registration.tsx");

    expect(guestRoute).toContain("httpOnly: true");
    expect(guestRoute).toContain('sameSite: "lax"');
    expect(guestMode).toContain('guestModeCookie = "2free-guest"');
    expect(guestMode).toContain("cookies()");
    expect(transactionRegistration).toContain("Los datos de la demo no se guardan");
  });

  it("uses shared shell styling without copying the legacy template", async () => {
    const globals = await readWebFile("app/globals.css");
    const workspaceShell = await readWebFile("components/workspace-shell.tsx");

    expect(globals).toContain('@import "tailwindcss";');
    expect(globals).toContain('@source "../node_modules/@camircode/twofree-ui/dist";');
    expect(globals).not.toMatch(/\.shell|\.sidebar|\.nav\s*\{|\.content\s*\{/);
    expect(globals).not.toContain("ui-shell__");
    expect(workspaceShell).toContain('label: "Inicio"');
    expect(workspaceShell).toContain('label: "Cuentas"');
    expect(workspaceShell).toContain('label: "Transacciones"');
    expect(workspaceShell).toContain('label: "Portabilidad"');
    expect(workspaceShell).not.toContain("Inversiones");
    expect(workspaceShell).toContain("onThemeToggle={toggleTheme}");
    expect(workspaceShell).toContain("theme={theme}");
  });

  it("initializes the saved theme before hydration", async () => {
    const layout = await readWebFile("app/layout.tsx");

    expect(layout).toContain('window.localStorage.getItem("2free-theme")');
    expect(layout).toContain("document.documentElement.dataset.theme = theme");
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain("dangerouslySetInnerHTML");
  });

  it("keeps loading, failure, and reduced-motion states informative in Spanish", async () => {
    const loading = await readWebFile("app/loading.tsx");
    const errorBoundary = await readWebFile("app/error.tsx");
    const motionEnhancement = await readWebFile("components/motion-enhancement.tsx");
    const routePlaceholder = await readWebFile("components/route-placeholder.tsx");

    expect(loading).toContain("Cargando");
    expect(loading).toContain('role="status"');
    expect(errorBoundary).toContain("No se pudo mostrar esta página");
    expect(errorBoundary).toContain("Intentar de nuevo");
    expect(motionEnhancement).toContain("data-motion={motionMode}");
    expect(motionEnhancement).toContain("data-motion-mode={motionMode}");
    expect(motionEnhancement).toContain("prefers-reduced-motion");
    expect(routePlaceholder).toContain('data-route-state="placeholder"');
    expect(routePlaceholder).toContain("Próximamente");
  });

  it("exposes a server health response without entering the workspace shell", async () => {
    const healthRoute = await readWebFile("app/health/route.ts");

    expect(healthRoute).toContain("export function GET");
    expect(healthRoute).toContain('status: "ready"');
    expect(healthRoute).toContain("content-type");
    expect(healthRoute).not.toContain("WorkspaceShell");
  });
});
