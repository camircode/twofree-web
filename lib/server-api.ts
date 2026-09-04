import "server-only";

import { headers } from "next/headers";

export class ServerApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Server API request failed");
    this.name = "ServerApiError";
    this.status = status;
  }
}

export function resolveServerApiUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.API_URL?.trim();
  if (!override) throw new Error("API_URL must be configured");
  try {
    new URL(override);
  } catch {
    throw new Error("API_URL must be a valid URL");
  }
  return override;
}

export async function serverApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const forwardedHeaders = new Headers(init?.headers);
  try {
    const cookie = (await headers()).get("cookie");
    if (cookie && !forwardedHeaders.has("cookie")) forwardedHeaders.set("cookie", cookie);
  } catch {
    // Unit adapters can run outside a Next request context.
  }
  const response = await fetch(new URL(path, resolveServerApiUrl()), {
    ...init,
    headers: forwardedHeaders,
    cache: "no-store",
  });

  if (!response.ok) throw new ServerApiError(response.status);
  return (await response.json()) as T;
}
