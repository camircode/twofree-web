"use client";

import { LogIn, LogOut } from "iconoir-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NamedIconButton, useDialogFocus } from "@camircode/twofree-ui";

import { browserApiBaseUrl } from "@/lib/runtime-api";
import { basePath } from "@/lib/base-path";

type SessionUser = Readonly<{ email: string; name?: string }>;
type Mode = "sign-in" | "sign-up";

async function authRequest(path: string, body?: Record<string, string>): Promise<Response> {
  return fetch(new URL(path, browserApiBaseUrl()), {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function AuthAccess({ guestMode }: Readonly<{ guestMode: boolean }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [user, setUser] = useState<SessionUser>();
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const closeAccess = useCallback(() => {
    setOpen(false);
    setFeedback("");
  }, []);

  useDialogFocus(open, dialogRef, closeAccess);

  useEffect(() => {
    if (guestMode) return;
    void authRequest("auth/get-session")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((session: { user?: SessionUser } | null) => {
        setUser(session?.user);
        if (!session?.user) setOpen(true);
      })
      .catch(() => setOpen(true));
  }, [guestMode]);

  useEffect(() => {
    const openAccess = () => setOpen(true);
    window.addEventListener("2free:open-auth", openAccess);
    return () => window.removeEventListener("2free:open-auth", openAccess);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const name = String(values.get("name") ?? "").trim();
    setPending(true);
    setFeedback("");
    try {
      const response = await authRequest(
        mode === "sign-up" ? "auth/sign-up/email" : "auth/sign-in/email",
        mode === "sign-up" ? { email, password, name } : { email, password },
      );
      const payload = (await response.json().catch(() => null)) as {
        user?: SessionUser;
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message || "No pudimos completar el acceso.");
      setUser(payload?.user ?? { email, name });
      setOpen(false);
      window.dispatchEvent(new Event("2free:session-changed"));
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pudimos completar el acceso.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      const response = await authRequest("auth/sign-out", {});
      if (!response.ok) throw new Error("No se pudo cerrar la sesión.");
      setUser(undefined);
      window.dispatchEvent(new Event("2free:session-changed"));
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo cerrar la sesión.");
    } finally {
      setPending(false);
    }
  }

  if (user) {
    return (
      <div className="auth-access__session">
        <NamedIconButton
          disabled={pending}
          icon={<LogOut />}
          label={pending ? "Cerrando sesión" : "Cerrar sesión"}
          onClick={signOut}
        />
      </div>
    );
  }

  if (guestMode) {
    return (
      <div className="auth-access__guest" aria-label="Modo invitado activo">
        <span className="auth-access__guest-status">
          <span>Demo</span>
          <small>Datos de ejemplo</small>
        </span>
        <a
          aria-label="Salir del modo demo"
          href={`${basePath}/guest?exit=1`}
          onClick={() => {
            window.sessionStorage.removeItem("2free-guest-accounts");
            window.sessionStorage.removeItem("2free-guest-transactions");
          }}
        >
          <LogOut aria-hidden="true" />
          <span>Salir</span>
        </a>
      </div>
    );
  }

  return (
    <>
      <button className="auth-access__trigger" onClick={() => setOpen(true)} type="button">
        <LogIn aria-hidden="true" />
        <span>Acceder</span>
      </button>
      {open ? (
        <div
          className="auth-access"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAccess();
          }}
          role="presentation"
        >
          <section
            aria-labelledby="auth-access-title"
            aria-describedby="auth-access-description"
            aria-modal="true"
            className="auth-access__dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="Cerrar acceso"
              className="auth-access__close"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
            <h2 id="auth-access-title">
              {mode === "sign-in" ? "Vuelva a sus finanzas" : "Cree su cuenta"}
            </h2>
            <p id="auth-access-description">
              Su sesión protege sus cuentas, transacciones y respaldos personales.
            </p>
            <div aria-label="Tipo de acceso" className="auth-access__modes">
              <button
                aria-pressed={mode === "sign-in"}
                onClick={() => {
                  setFeedback("");
                  setMode("sign-in");
                }}
                type="button"
              >
                Iniciar sesión
              </button>
              <button
                aria-pressed={mode === "sign-up"}
                onClick={() => {
                  setFeedback("");
                  setMode("sign-up");
                }}
                type="button"
              >
                Crear cuenta
              </button>
            </div>
            <form onSubmit={submit}>
              {mode === "sign-up" ? (
                <label>
                  Nombre
                  <input
                    autoComplete="name"
                    data-dialog-initial-focus
                    id="auth-name"
                    name="name"
                    required
                  />
                </label>
              ) : null}
              <label>
                Correo
                <input
                  autoComplete="email"
                  data-dialog-initial-focus={mode === "sign-in" ? true : undefined}
                  id="auth-email"
                  name="email"
                  required
                  type="email"
                />
              </label>
              <label>
                Contraseña
                <input
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  id="auth-password"
                  minLength={8}
                  name="password"
                  required
                  type="password"
                />
              </label>
              {feedback ? (
                <p aria-live="assertive" role="alert">
                  {feedback}
                </p>
              ) : null}
              <button disabled={pending} type="submit">
                {pending ? "Conectando…" : mode === "sign-in" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            </form>
            <div className="auth-access__guest-entry">
              <span>¿Solo desea explorar?</span>
              <a href={`${basePath}/guest`}>Probar sin crear una cuenta</a>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
