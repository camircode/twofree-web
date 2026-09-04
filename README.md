# twofree-web

The 2 Free workspace: a Next.js 16 App Router application, built as a
`standalone` server image and served under the `/app` prefix of
`https://2free.camir.tech`. The landing page owns the root of that host.

It renders on the server through `lib/server-api.ts` and forwards browser
requests to the API through the route handler at `app/api/[...path]/route.ts`.
The API is an in-cluster Service with no public address, so the proxy is the
only path from a browser to it — and it keeps the session cookie first-party.

## Shared packages

The domain, provider and UI code lives in
[camircode/twofree-packages](https://github.com/camircode/twofree-packages) and
is published to GitHub Packages under the `@camircode` scope. They are private,
so `pnpm install` needs a token with `read:packages`:

```sh
printf '//npm.pkg.github.com/:_authToken=%s\n' "$GITHUB_TOKEN" >> ~/.npmrc
```

The registry mapping is in the committed `.npmrc`. The token is not, and never
should be: put it in `~/.npmrc`, and let CI pass it to the image build as a
BuildKit secret.

There is no `pnpm-lock.yaml` yet. It cannot be resolved until the `@camircode`
packages exist in the registry, and a lockfile pinning anything else would be a
lie about what the image installs. The first `pnpm install` against the
published packages produces it; commit it in that same change, because the
Dockerfile and the pipeline both install with `--frozen-lockfile`.

## Development

```sh
pnpm install
pnpm dev            # http://localhost:3000/app
pnpm check          # format, lint, typecheck and the unit suites
pnpm test:browser   # needs: pnpm exec playwright install chromium
```

`API_URL` and `NEXT_PUBLIC_API_URL` are described in `.env.example`. The first
is read at request time; the second is inlined into the client bundle at build
time.

## The path prefix

`lib/base-path.ts` holds the prefix, and `next.config.ts`, the fetch helper and
the browser tests all read it from there. Nothing else may spell it out. If the
config and the fetch helper ever disagree the build still passes: the wrong
prefix is answered by the landing page with a 200 and HTML, so the failure shows
up as a parse error in a browser somewhere far from the cause.

## Deployment

Jenkins builds the image, pushes it to `ghcr.io/camircode/twofree-web` by
digest, smoke-tests that digest as uid 10001 with a read-only root filesystem,
scans it, and commits the digest to `camircode/gitops`. Argo CD reconciles the
cluster from that repository.

Nothing here applies anything to the cluster, and neither should you: a
`kubectl apply` is a change Argo CD will revert, and it leaves no trace in the
deployment history, which is the git log of `camircode/gitops`.
