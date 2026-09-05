import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { apiProxyPath, basePath } from "../lib/base-path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readRepositoryFile(relativePath: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readRepositoryFile(relativePath)) as Record<string, unknown>;
}

describe("Next foundation contract", () => {
  it("pins the Next runtime and the published shared packages", async () => {
    const packageJson = await readJson("package.json");
    const dependencies = packageJson.dependencies as Record<string, string>;
    const devDependencies = packageJson.devDependencies as Record<string, string>;
    const scripts = packageJson.scripts as Record<string, string>;

    // The shared packages are checked by shape, not by exact version. What
    // matters is that they come from the registry as a published range — a
    // `workspace:*` here would mean this repository had quietly gone back to
    // resolving them from a checkout that CI does not have. Asserting the patch
    // version adds nothing to that and breaks this test on every release, which
    // is a build failure that teaches people to edit the test rather than read
    // it.
    for (const name of [
      "@camircode/twofree-application",
      "@camircode/twofree-data-provider",
      "@camircode/twofree-ui",
    ]) {
      expect(dependencies[name]).toMatch(/^\^\d+\.\d+\.\d+$/u);
    }

    expect(dependencies).toMatchObject({
      next: "16.2.11",
      react: "19.2.7",
      "react-dom": "19.2.7",
      "server-only": "0.0.1",
    });
    expect(devDependencies).toMatchObject({
      "@tailwindcss/postcss": "4.3.3",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
      tailwindcss: "4.3.3",
    });
    expect(scripts).toMatchObject({
      build: "next build",
      dev: "next dev",
      start: "next start",
      typecheck: "next typegen && tsc --noEmit",
    });

    // The shared packages are private on GitHub Packages. The registry mapping
    // is committed; a token in this file would be a published credential.
    const npmrc = await readRepositoryFile(".npmrc");
    expect(npmrc).toContain("@camircode:registry=https://npm.pkg.github.com");
    expect(npmrc).not.toMatch(/_authToken|_password|:_auth=/);

    // Read as JSON, not as text: `next typegen` rewrites this file in place and
    // reformats it, so a substring assertion breaks on the first build.
    const tsconfig = await readJson("tsconfig.json");
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;
    expect((compilerOptions.paths as Record<string, string[]>)["@/*"]).toEqual(["./*"]);
    expect(tsconfig.include).toContain("types/**/*.d.ts");

    const postcssConfig = await readRepositoryFile("postcss.config.mjs");
    expect(postcssConfig).toContain('"@tailwindcss/postcss"');
  });

  it("serves the application under one path prefix that is defined in one place", async () => {
    const nextConfig = await readRepositoryFile("next.config.ts");
    const runtimeApi = await readRepositoryFile("lib/runtime-api.ts");

    expect(basePath).toBe("/app");
    expect(apiProxyPath).toBe("/app/api/");

    // next.config.ts and the browser fetch helper must read the same constant.
    // Two literals would let the assets and the API calls drift onto different
    // prefixes, which the build cannot catch: the wrong prefix still returns
    // 200, served by the landing page that owns the root of this host.
    expect(nextConfig).toContain('import { basePath } from "./lib/base-path"');
    expect(nextConfig).toContain("basePath,");
    expect(nextConfig).toContain('output: "standalone"');
    // Turbopack only turns an imported .svg into the { src, width, height }
    // object next/image needs for packages it compiles itself. Without this the
    // logo import is a bare URL string, every render throws on logo.width, and
    // the page still answers 200 — with a hole where the logo was.
    expect(nextConfig).toContain('transpilePackages: ["@camircode/twofree-ui"]');
    expect(nextConfig).toContain("outputFileTracingRoot: appDir");
    expect(runtimeApi).toContain('import { apiProxyPath } from "./base-path"');
    expect(runtimeApi).not.toMatch(/["'`]\/app/u);

    // Only the one function may build the browser base URL, so the prefix
    // cannot be reintroduced at a call site.
    const callers = await Promise.all(
      [
        "components/account-registration.tsx",
        "components/account-settings.tsx",
        "components/auth-access.tsx",
        "components/home-greeting.tsx",
        "components/portability-workspace.tsx",
        "components/product-pages.tsx",
        "lib/finance-record-api.ts",
        "lib/transaction-api.ts",
      ].map(readRepositoryFile),
    );
    for (const caller of callers) {
      expect(caller).toContain("browserApiBaseUrl");
      expect(caller).not.toMatch(/window\.location\.origin/u);
    }
  });

  it("keeps the runtime image unprivileged, read-only and on the deployed port", async () => {
    const dockerfile = await readRepositoryFile("Dockerfile");

    expect(dockerfile).toContain("# syntax=docker/dockerfile:1");
    expect(dockerfile).toContain("USER 10001");
    expect(dockerfile).toContain("PORT=8080");
    expect(dockerfile).toContain("HOSTNAME=0.0.0.0");

    // The token reaches the build as a mount, never as an ARG: an ARG is
    // recorded in the image history and `docker history` prints it back.
    expect(dockerfile).toContain("--mount=type=secret,id=npmrc,target=/root/.npmrc");
    expect(dockerfile).not.toMatch(/ARG\s+(?:NPM|GH|GITHUB)\w*(?:TOKEN|PASS|SECRET)/u);

    // Standalone emits server.js without the static assets beside it. Omitting
    // either copy produces a site that loads with no CSS and no images, and the
    // build stays green because nothing here is compiled.
    expect(dockerfile).toContain(".next/static");
    expect(dockerfile).toContain("public");
  });

  it("keeps API_URL and shared assets on the server-side boundary", async () => {
    const layout = await readRepositoryFile("app/layout.tsx");
    const page = await readRepositoryFile("app/page.tsx");
    const globals = await readRepositoryFile("app/globals.css");
    const serverApi = await readRepositoryFile("lib/server-api.ts");

    expect(layout).toContain('import "@camircode/twofree-ui/styles.css";');
    expect(layout).toContain(
      'import logo from "@camircode/twofree-ui/assets/2free-con-fondi.svg";',
    );
    expect(serverApi.startsWith('import "server-only";')).toBe(true);
    expect(serverApi).toContain("environment.API_URL");
    expect(serverApi).toContain('throw new Error("API_URL must be configured")');

    // API_URL names the in-cluster Service. It is read at request time and must
    // never be inlined into a client bundle the way NEXT_PUBLIC_* values are.
    expect(`${layout}\n${page}`).not.toMatch(/API_URL|127\.0\.0\.1:3001|api:3001/);
    expect(globals).toContain('@import "tailwindcss";');
    expect(globals).toContain('@source "./";');
    expect(globals).not.toContain("@font-face");
    expect(globals).not.toContain("ui-shell__");
  });
});
