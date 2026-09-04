"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { browserApiBaseUrl } from "@/lib/runtime-api";

type SessionUser = Readonly<{ email: string; name?: string }>;
type AccountStatus = "loading" | "ready" | "signed-out" | "error";
type PendingAction = "name" | "password" | null;
type Feedback = Readonly<{ tone: "success" | "error"; message: string }>;

type AuthRequestResult = Readonly<{
  response: Response;
  payload: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sessionUserFromPayload(payload: unknown): SessionUser | undefined {
  if (!isRecord(payload) || !isRecord(payload.user) || typeof payload.user.email !== "string") {
    return undefined;
  }

  return {
    email: payload.user.email,
    ...(typeof payload.user.name === "string" ? { name: payload.user.name } : {}),
  };
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const candidate = payload.message ?? payload.error;
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  if (Array.isArray(candidate)) {
    const message = candidate
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join(" ");
    if (message) return message;
  }
  return fallback;
}

async function authRequest(
  path: string,
  body?: Readonly<Record<string, string>>,
): Promise<AuthRequestResult> {
  const response = await fetch(new URL(path, browserApiBaseUrl()), {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { payload, response };
}

export function AccountSettings() {
  const router = useRouter();
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [user, setUser] = useState<SessionUser>();
  const [loadError, setLoadError] = useState("");
  const [nameFeedback, setNameFeedback] = useState<Feedback | null>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    let active = true;
    void authRequest("auth/get-session")
      .then(({ payload, response }) => {
        if (!active) return;
        const currentUser = response.ok ? sessionUserFromPayload(payload) : undefined;
        if (currentUser) {
          setUser(currentUser);
          setStatus("ready");
          return;
        }
        if (response.ok || response.status === 401) {
          setStatus("signed-out");
          return;
        }
        setLoadError("No se pudo cargar la cuenta. Intente de nuevo más tarde.");
        setStatus("error");
      })
      .catch(() => {
        if (!active) return;
        setLoadError("No se pudo cargar la cuenta. Intente de nuevo más tarde.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") ?? "").trim();
    setNameFeedback(null);
    if (!name) {
      setNameFeedback({ tone: "error", message: "Escriba un nombre para mostrar." });
      return;
    }

    setPending("name");
    try {
      const { payload, response } = await authRequest("auth/update-user", { name });
      if (!response.ok) {
        throw new Error(messageFromPayload(payload, "No se pudo actualizar el nombre."));
      }
      setUser((current) => (current ? { ...current, name } : current));
      setNameFeedback({ tone: "success", message: "Nombre actualizado." });
      window.dispatchEvent(new Event("2free:session-changed"));
      router.refresh();
    } catch (error) {
      setNameFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo actualizar el nombre.",
      });
    } finally {
      setPending(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get("currentPassword") ?? "");
    const newPassword = String(values.get("newPassword") ?? "");
    const confirmation = String(values.get("confirmation") ?? "");
    setPasswordFeedback(null);
    if (newPassword !== confirmation) {
      setPasswordFeedback({
        tone: "error",
        message: "La confirmación no coincide con la nueva contraseña.",
      });
      return;
    }

    setPending("password");
    try {
      const { payload, response } = await authRequest("auth/change-password", {
        currentPassword,
        newPassword,
      });
      if (!response.ok) {
        throw new Error(messageFromPayload(payload, "No se pudo cambiar la contraseña."));
      }
      form.reset();
      setPasswordFeedback({ tone: "success", message: "Contraseña actualizada." });
    } catch (error) {
      setPasswordFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo cambiar la contraseña.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="account-settings-title" className="account-settings">
      <div className="account-settings__intro">
        <h2 id="account-settings-title">Administre su cuenta</h2>
        <p>
          Actualice la información que identifica su espacio y mantenga sus credenciales bajo su
          control.
        </p>
      </div>
      {status === "loading" ? (
        <p aria-live="polite" className="account-settings__state" role="status">
          Cargando la cuenta...
        </p>
      ) : status === "signed-out" ? (
        <div className="account-settings__state" role="alert">
          <h3>Sesión requerida</h3>
          <p>Inicie sesión para consultar y administrar la configuración de su cuenta.</p>
          <button onClick={() => window.dispatchEvent(new Event("2free:open-auth"))} type="button">
            Iniciar sesión
          </button>
        </div>
      ) : status === "error" ? (
        <p className="account-settings__state" role="alert">
          {loadError}
        </p>
      ) : user ? (
        <>
          <div className="account-settings__context">
            <label className="account-settings__field">
              Correo de la cuenta
              <input autoComplete="email" readOnly type="email" value={user.email} />
            </label>
            <p>El correo es el contexto de acceso y no se modifica desde esta página.</p>
          </div>
          <div className="account-settings__forms">
            <form
              aria-busy={pending === "name"}
              className="account-settings__form"
              onSubmit={updateName}
            >
              <div className="account-settings__form-intro">
                <h3>Nombre visible</h3>
                <p>Es el nombre que puede reconocer en su espacio de trabajo.</p>
              </div>
              <label className="account-settings__field">
                Nombre para mostrar
                <input
                  autoComplete="name"
                  defaultValue={user.name ?? ""}
                  name="name"
                  required
                  type="text"
                />
              </label>
              {nameFeedback ? (
                <p
                  className={`account-settings__feedback account-settings__feedback--${nameFeedback.tone}`}
                  role={nameFeedback.tone === "error" ? "alert" : "status"}
                >
                  {nameFeedback.message}
                </p>
              ) : null}
              <button disabled={pending !== null} type="submit">
                {pending === "name" ? "Guardando..." : "Guardar nombre"}
              </button>
            </form>
            <form
              aria-busy={pending === "password"}
              className="account-settings__form"
              onSubmit={changePassword}
            >
              <div className="account-settings__form-intro">
                <h3>Cambiar contraseña</h3>
                <p>Use una contraseña nueva que no comparta con otros servicios.</p>
              </div>
              <div className="account-settings__fields">
                <label className="account-settings__field">
                  Contraseña actual
                  <input
                    autoComplete="current-password"
                    name="currentPassword"
                    required
                    type="password"
                  />
                </label>
                <label className="account-settings__field">
                  Nueva contraseña
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    name="newPassword"
                    required
                    type="password"
                  />
                </label>
                <label className="account-settings__field">
                  Confirmar nueva contraseña
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    name="confirmation"
                    required
                    type="password"
                  />
                </label>
              </div>
              {passwordFeedback ? (
                <p
                  className={`account-settings__feedback account-settings__feedback--${passwordFeedback.tone}`}
                  role={passwordFeedback.tone === "error" ? "alert" : "status"}
                >
                  {passwordFeedback.message}
                </p>
              ) : null}
              <button disabled={pending !== null} type="submit">
                {pending === "password" ? "Actualizando..." : "Cambiar contraseña"}
              </button>
            </form>
          </div>
        </>
      ) : null}
    </section>
  );
}
