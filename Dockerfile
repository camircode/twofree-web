# syntax=docker/dockerfile:1

# Multi-stage so the toolchain never reaches the running image. A package
# manager, a TypeScript compiler and the whole Next build pipeline in production
# are attack surface that does nothing once the build is over.

# --- dependencies -------------------------------------------------------------
# Its own stage, and only the manifests are copied, so this layer is cached
# unless the lockfile changes. Ordinary code changes do not re-resolve the tree.
#
# The @camircode packages are private on GitHub Packages, so the install needs a
# read token. It arrives as a BuildKit secret mounted for the length of one RUN:
# not an ARG, because an ARG is recorded in the image history and `docker
# history` prints it back to anyone who can pull the image, and not a COPY,
# because a copied file stays in its layer even after a later RUN deletes it.
FROM node:24-alpine AS deps
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile

# --- build --------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY --from=deps /src/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json next.config.ts postcss.config.mjs next-env.d.ts ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY types ./types

# Inlined into the client bundle by `next build`, so it is a build input rather
# than a runtime setting: changing it later means rebuilding the image. It holds
# the public address of this application including its path prefix, and it is
# only read while rendering on the server, where there is no window.location to
# ask. It is public by construction — no secret belongs in a NEXT_PUBLIC_* name.
ARG NEXT_PUBLIC_API_URL=https://2free.camir.tech/app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN pnpm build

# --- the image that runs ------------------------------------------------------
FROM node:24-alpine AS runtime

# The base image's tag is rebuilt on Node releases, not on Alpine security
# updates, so its package tree is as old as the last Node release. Trivy runs
# with --ignore-unfixed and fails the build on HIGH or CRITICAL, so anything it
# reports already has a patch waiting in the Alpine repositories. Taking those
# patches here is the fix; writing an exception for an already-fixed
# vulnerability is not.
RUN apk upgrade --no-cache

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# `output: "standalone"` emits server.js next to a node_modules pruned down to
# what the traced routes import — and nothing else. The two copies below are the
# nothing else, and both are easy to forget:
#
#   .next/static holds the hashed CSS and JS chunks the HTML references. Without
#   it every /_next/static/... request 404s and the site renders as unstyled
#   markup.
#
#   public/ holds whatever is served verbatim from the root.
#
# Neither omission fails the build, because nothing here is compiled: the image
# builds, starts, answers the health probe, and serves a broken page.
COPY --from=build --chown=10001:10001 /src/.next/standalone ./
COPY --from=build --chown=10001:10001 /src/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /src/public ./public

# Matches runAsUser in the Deployment. Declaring it here as well means the image
# is safe to run without a securityContext rather than depending on one, and it
# is a numeric uid because runAsNonRoot cannot verify a name.
USER 10001

# The Deployment mounts an emptyDir at /tmp and gives the container a read-only
# root filesystem. Nothing above is written to at runtime: the pages are
# dynamic, so Next never writes an ISR cache, and telemetry — which does write
# under the working directory — is off.
EXPOSE 8080

CMD ["node", "server.js"]
