"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AppShell, type NavigationItem } from "@camircode/twofree-ui";

import { basePath } from "@/lib/base-path";

import { AuthAccess } from "./auth-access";
import { MotionEnhancement } from "./motion-enhancement";

type WorkspaceShellProps = Readonly<{
  brand: ReactNode;
  children: ReactNode;
  guestMode: boolean;
}>;

type Theme = "dark" | "light";

const navigation = [
  { id: "inicio", label: "Inicio", href: "/" },
  { id: "cuentas", label: "Cuentas", href: "/cuentas" },
  { id: "transacciones", label: "Transacciones", href: "/transacciones" },
  { id: "presupuesto", label: "Presupuesto", href: "/presupuesto" },
] as const satisfies readonly (NavigationItem & { href: string })[];

const secondaryNavigation = [
  { id: "compartidos", label: "Compartidos", href: "/compartidos" },
  { id: "alertas", label: "Alertas", href: "/alertas" },
  { id: "portabilidad", label: "Portabilidad", href: "/portabilidad" },
  { id: "ajustes", label: "Ajustes", href: "/ajustes" },
] as const satisfies readonly (NavigationItem & { href: string })[];

const mobileNavigation = [
  { id: "inicio", label: "Inicio", href: "/" },
  { id: "presupuesto", label: "Plan", href: "/presupuesto" },
  { id: "transacciones", label: "Actividad", href: "/transacciones" },
  { id: "mas", label: "Más", href: "/ajustes" },
] as const satisfies readonly (NavigationItem & { href: string })[];

const allNavigation = [...navigation, ...secondaryNavigation] as const;

// AppShell renders each item as a plain <a>, which Next never sees and
// therefore never prefixes. Left bare, every navigation item points at the root
// of this host, where the landing page answers — a full page load out of the
// application rather than a 404 anyone would notice.
//
// The hrefs above stay unprefixed on purpose: usePathname() also reports the
// path without the prefix, and routeIsActive compares the two.
function withBasePath<Item extends { href: string }>(items: readonly Item[]): Item[] {
  return items.map((item) => ({ ...item, href: `${basePath}${item.href}` }));
}

const navigationLinks = withBasePath(navigation);
const secondaryNavigationLinks = withBasePath(secondaryNavigation);
const mobileNavigationLinks = withBasePath(mobileNavigation);

function routeIsActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function applyDocumentTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--surface-canvas")
    .trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
}

export function WorkspaceShell({ brand, children, guestMode }: WorkspaceShellProps) {
  const pathname = usePathname() ?? "/";
  const [theme, setTheme] = useState<Theme>("light");
  const themeReadyRef = useRef(false);
  const userThemeRef = useRef(false);

  useEffect(() => {
    if (!themeReadyRef.current) return;
    applyDocumentTheme(theme);
    if (userThemeRef.current) window.localStorage.setItem("2free-theme", theme);
  }, [theme]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("2free-theme");
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const initialTheme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : mediaQuery.matches
          ? "dark"
          : "light";
    if (storedTheme === "dark" || storedTheme === "light") {
      userThemeRef.current = true;
    }
    applyDocumentTheme(initialTheme);
    themeReadyRef.current = true;
    setTheme(initialTheme);

    const syncSystemTheme = () => {
      if (!userThemeRef.current) setTheme(mediaQuery.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener?.("change", syncSystemTheme);
    return () => mediaQuery.removeEventListener?.("change", syncSystemTheme);
  }, []);

  const activeItemId = useMemo(
    () => allNavigation.find((item) => routeIsActive(pathname, item.href))?.id,
    [pathname],
  );

  const toggleTheme = useCallback(() => {
    userThemeRef.current = true;
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  return (
    <div
      className="workspace-shell"
      data-motion-settled="true"
      data-shell-surface="route"
      data-workspace-shell
    >
      <MotionEnhancement />
      <AppShell
        activeItemId={activeItemId}
        actions={<AuthAccess guestMode={guestMode} />}
        brand={brand}
        mobileNavigation={mobileNavigationLinks}
        navigation={navigationLinks}
        secondaryNavigation={secondaryNavigationLinks}
        onThemeToggle={toggleTheme}
        theme={theme}
      >
        {children}
      </AppShell>
    </div>
  );
}
