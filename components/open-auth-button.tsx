"use client";

import type { ReactNode } from "react";

export function OpenAuthButton({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <button
      className="web-route-page__button"
      onClick={() => window.dispatchEvent(new Event("2free:open-auth"))}
      type="button"
    >
      {children}
    </button>
  );
}
