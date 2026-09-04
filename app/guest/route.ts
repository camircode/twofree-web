import { NextResponse } from "next/server";

import { basePath } from "@/lib/base-path";
import { guestModeCookie } from "@/lib/guest-mode";

export function GET(request: Request): NextResponse {
  const requestUrl = new URL(request.url);
  const leaving = requestUrl.searchParams.get("exit") === "1";
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https:" : requestUrl.protocol;
  // Next does not rewrite a Location header written by hand, so the basePath has
  // to be spelled out. Redirecting to a bare "/" would send the visitor to the
  // landing page that owns the root of this host instead of the workspace home.
  const response = new NextResponse(null, {
    headers: { location: `${basePath}/` },
    status: 307,
  });
  // Scoped to the application prefix so the landing page never receives it: the
  // cookie says nothing more than "demo mode", but a cookie sent to a route that
  // has no use for it is a cookie that can leak in a log.
  response.cookies.set(guestModeCookie, leaving ? "" : "1", {
    httpOnly: true,
    maxAge: leaving ? 0 : 60 * 60 * 4,
    path: basePath,
    sameSite: "lax",
    secure: protocol === "https:",
  });
  return response;
}
