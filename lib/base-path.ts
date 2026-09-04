/**
 * The landing page owns the root of https://2free.camir.tech, so this
 * application is served under a path prefix by an HTTPRoute rule. Every part of
 * the app that builds a URL by hand has to agree on that prefix.
 *
 * It lives here, in one exported constant, rather than being repeated in
 * next.config.ts and in the fetch helpers. When the two disagree Next rewrites
 * the assets and <Link> hrefs to one prefix while the client fetches the other,
 * and the mismatch does not fail the build: it 404s at runtime against the
 * landing site, which answers 200 with HTML, so the browser reports a JSON
 * parse error somewhere far from the cause.
 */
export const basePath = "/app";

/**
 * Where app/api/[...path]/route.ts answers once Next has applied the basePath.
 * The trailing slash is load-bearing: callers resolve relative paths against
 * this value with `new URL(path, base)`, and without it the last segment is
 * replaced instead of extended.
 */
export const apiProxyPath = `${basePath}/api/`;
