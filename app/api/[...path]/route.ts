import { resolveServerApiUrl } from "@/lib/server-api";

type RouteContext = Readonly<{ params: Promise<{ path: string[] }> }>;

const forwardedResponseHeaders = [
  "cache-control",
  "content-type",
  "etag",
  "location",
  "retry-after",
  "vary",
  "www-authenticate",
] as const;

function upstreamPath(path: readonly string[]): string {
  const segments = path[0] === "auth" ? ["api", "auth", ...path.slice(1)] : path;
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  if (path.length === 0) return new Response("Not found", { status: 404 });

  let target: string;
  try {
    target = resolveServerApiUrl();
  } catch {
    return Response.json(
      { message: "API_URL must be configured with a valid URL." },
      { status: 500 },
    );
  }

  const url = new URL(upstreamPath(path), `${target}/`);
  url.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("host");
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await fetch(url, {
    body,
    cache: "no-store",
    headers,
    method: request.method,
    redirect: "manual",
  });
  const responseHeaders = new Headers();
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const upstreamHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = upstreamHeaders.getSetCookie?.() ?? [];
  if (setCookies.length) {
    for (const cookie of setCookies) responseHeaders.append("set-cookie", cookie);
  } else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) responseHeaders.set("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    headers: responseHeaders,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
export const PATCH = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
