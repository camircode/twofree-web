"use client";

import { useCallback, useEffect, useState } from "react";

import { browserApiBaseUrl } from "@/lib/runtime-api";

type SessionResponse = Readonly<{ user?: Readonly<{ name?: string }> }>;

export function HomeGreeting({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  const [firstName, setFirstName] = useState(guestMode ? "invitado" : "");

  const loadName = useCallback(async () => {
    if (guestMode) {
      setFirstName("invitado");
      return;
    }
    try {
      const response = await fetch(new URL("auth/get-session", browserApiBaseUrl()), {
        credentials: "include",
      });
      const session = response.ok ? ((await response.json()) as SessionResponse) : undefined;
      setFirstName(session?.user?.name?.trim().split(/\s+/u)[0] ?? "");
    } catch {
      setFirstName("");
    }
  }, [guestMode]);

  useEffect(() => {
    void loadName();
    window.addEventListener("2free:session-changed", loadName);
    return () => window.removeEventListener("2free:session-changed", loadName);
  }, [loadName]);

  return <h1>{firstName ? `Hola, ${firstName}` : "Hola"}</h1>;
}
