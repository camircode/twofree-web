import type { Metadata, Viewport } from "next";
import Image from "next/image";
import type { ReactNode } from "react";

import "@camircode/twofree-ui/styles.css";
import logo from "@camircode/twofree-ui/assets/2free-con-fondi.svg";

import { WorkspaceShell } from "@/components/workspace-shell";
import { basePath } from "@/lib/base-path";
import { isGuestMode } from "@/lib/guest-mode";

import "./globals.css";

export const metadata: Metadata = {
  title: "2 Free",
  description: "Espacio financiero de 2 Free",
  icons: {
    icon: {
      url: logo.src,
      type: "image/svg+xml",
    },
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

const themeInitializationScript = `(() => {
  try {
    const storedTheme = window.localStorage.getItem("2free-theme");
    const theme = storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();`;

export default async function RootLayout({ children }: RootLayoutProps) {
  const guestMode = await isGuestMode();
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body data-route-root="workspace">
        <WorkspaceShell
          guestMode={guestMode}
          brand={
            <a
              aria-label="2 Free, Inicio"
              className="workspace-shell__brand-link"
              href={`${basePath}/`}
            >
              <Image alt="2 Free" height={logo.height} priority src={logo.src} width={logo.width} />
            </a>
          }
        >
          {children}
        </WorkspaceShell>
      </body>
    </html>
  );
}
