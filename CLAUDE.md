# CLAUDE.md — `camircode/twofree-web`

The 2 Free workspace: Next.js 16 App Router, built `output: "standalone"`, served
as `ghcr.io/camircode/twofree-web` on port 8080 as uid 10001. Domain, provider and
UI code comes from `camircode/twofree-packages` as `@camircode/twofree-*`; this
repository is the rendering layer, the API proxy and its delivery.

It is served under the **`/app` prefix** of `https://2free.camir.tech`.
`camircode/twofree-landing` owns the root of that host — which is why several of
the rules below exist.

---

## 1. How a change reaches the cluster

Commit to `main` → **Jenkins polls every five minutes** (a webhook is impossible:
the controller is only reachable over WireGuard, so GitHub cannot call it) →
lint/typecheck/test in a container → `docker buildx` push to GHCR **by digest** →
smoke-test that digest → Trivy (HIGH/CRITICAL, `--ignore-unfixed`) → commit the
digest into `manifests/twofree-web/deployment.yaml` in `camircode/gitops` → Argo
CD syncs.

The pipeline never touches the cluster. The git log of `camircode/gitops` is the
deployment history.

- **Never `kubectl apply`.** Argo CD is the only writer. A manual apply makes the
  cluster and the repository disagree, and Argo either reverts it or reports
  drift forever. `kubectl get/describe/logs/top`, `port-forward` and `exec` are
  fine.
- **Images are referenced by digest, never a tag and never `latest`.** A tag is a
  mutable pointer: two pods started an hour apart from the same tag can run
  different code, and a rollback to a tag rolls back to whatever that tag means
  today.
- **Secrets come from Bitwarden Secrets Manager only** — never in this repo,
  never in a ConfigMap, never in a plaintext Secret in the GitOps repo, never a
  build `ARG` (it persists in image history and `docker history` prints it back),
  never on a command line. The GHCR read token reaches the build as a **BuildKit
  secret mount** (`--secret id=npmrc`), never as an ARG or a COPY.
- **One PostgreSQL on `data-01`** with a role and database per app; **Gateway
  API, never `Ingress`**; infrastructure changes belong in
  `/home/camir/Desarrollo/infrastructure`.

Containers run non-root, read-only root filesystem, all capabilities dropped,
emptyDir at `/tmp`. Verify a container change the way Kubernetes will run it —
`docker run --user 10001:10001 --read-only --tmpfs /tmp ...` — because this class
of failure never appears in a build and the tests never see it: they run against
the source, not the image.

## 2. The shared packages are a release, not a directory

A change to `@camircode/twofree-*` must be versioned and published from
`twofree-packages` *before* the bump here can install. Bumping to an unpublished
version fails in the `deps` stage of the Docker build, minutes into a Jenkins
run, as a resolver error about a tarball.

## 3. There is no committed lockfile — and the build already demands one

`pnpm-lock.yaml` is absent, because it cannot be resolved until the `@camircode`
packages exist in the registry. But the `Dockerfile` already does
`COPY package.json pnpm-lock.yaml ...` and `pnpm install --frozen-lockfile`, and
the `Jenkinsfile` `Test` stage does the same. **The image build cannot succeed
until the lockfile exists.**

So: the first `pnpm install` against the published packages must **commit
`pnpm-lock.yaml` in that same change**, and every later manifest change must
commit the regenerated lockfile with it. Otherwise the failure is a `COPY` that
cannot find its source, or a `--frozen-lockfile` install rejecting the tree.

## 4. `/app` is applied by Next only where Next generates the URL

`lib/base-path.ts` holds `basePath = "/app"` and `apiProxyPath`. Nothing else may
spell the prefix out — `next.config.ts` imports it, and so do the fetch helpers
and the browser tests.

Next prefixes what *it* generates: `<Link>`, `/_next/**`, route handlers. It does
not touch a URL you write by hand, and there are two of those:

- **`AppShell`** from `@camircode/twofree-ui` renders each navigation item as a
  plain `<a href>`, which Next never sees. `components/workspace-shell.tsx` maps
  the prefix onto every item's `href` before passing them in. A navigation item
  introduced anywhere else must go through that same mapping.
- **`app/guest/route.ts`** writes its `Location` header by hand. Redirecting to a
  bare `/` sends the visitor to the landing page instead of the workspace home.
  Its cookie is also scoped to `path: basePath` so the landing site never
  receives it.

A prefix mismatch does **not** fail the build. The wrong path is answered by the
landing site with a 200 and HTML, so it surfaces as a JSON parse error in a
browser, far from the cause. The `Smoke test` stage greps the HTML at `/app` for
`/app/_next/` precisely because `/app/health` answers 200 from wherever it is
mounted and proves nothing.

## 5. `transpilePackages` is load-bearing, not monorepo residue

`next.config.ts` sets `transpilePackages: ["@camircode/twofree-ui"]`. Turbopack
only wraps an imported `.svg` into the `{ src, width, height }` object
`next/image` needs for modules it compiles itself. Remove that line and the
import becomes a bare URL string, `logo.width` is `undefined`, and **every SSR
render throws** `Cannot read properties of undefined (reading 'toString')` while
the page still answers 200 with a logo-shaped hole in it. `next build` passes
clean.

## 6. `API_URL` runtime, `NEXT_PUBLIC_API_URL` build time

- `API_URL` is read per request by `lib/server-api.ts` and points at the
  in-cluster API Service. It must **never** be baked into the image: it is an env
  var on the Deployment, and changing it is a restart, not a rebuild.
- `NEXT_PUBLIC_API_URL` is inlined into the client bundle by `next build` (it is
  a `--build-arg` in the `Dockerfile`). Changing it means rebuilding the image.
  It holds this application's own public address including the prefix, and it is
  public by construction — no secret ever belongs in a `NEXT_PUBLIC_*` name.

The browser never talks to the API directly: it goes to
`app/api/[...path]/route.ts` same-origin, which forwards over the cluster
network. The API Service has no public address, and the proxy is what keeps the
session cookie first-party.

## 7. Working here

```sh
pnpm install        # needs a read:packages token in your own ~/.npmrc
pnpm dev            # http://localhost:3000/app
pnpm check          # format:check, lint, typecheck, test — what CI runs
pnpm test:browser   # needs: pnpm exec playwright install chromium
```

The browser suites are deliberately not in the pipeline: they drive a real
Chromium against `next dev`. What the pipeline proves about the artefact, it
proves by starting the image.
