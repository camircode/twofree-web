import { apiProxyPath } from "./base-path";

export function browserApiBaseUrl(): string {
  // Same-origin on purpose: the browser talks to the Next route handler, which
  // forwards to the API over the cluster network. The API Service is not
  // reachable from a browser, and going through the proxy is what keeps the
  // session cookie first-party.
  if (typeof window !== "undefined") return new URL(apiProxyPath, window.location.origin).href;

  // Only reached while rendering on the server, where there is no origin to
  // read. NEXT_PUBLIC_API_URL is inlined at build time, so it holds the public
  // address of this application rather than the address of the API.
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) throw new Error("NEXT_PUBLIC_API_URL must be configured");
  return new URL(apiProxyPath, configured).href;
}
