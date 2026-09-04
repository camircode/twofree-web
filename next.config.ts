import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { basePath } from "./lib/base-path";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // The landing page answers at https://2free.camir.tech/ and this application
  // answers under a prefix on the same host. Without basePath every /_next/...
  // asset and every <Link> resolves at the root, where the landing site returns
  // its own HTML: the page loads unstyled and every navigation leaves the app.
  basePath,

  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  // Produces .next/standalone with a server.js and only the modules the traced
  // routes actually import, so the runtime image carries no pnpm store and no
  // build toolchain.
  output: "standalone",

  // The repository root, which is also the app root now that this is not a
  // workspace. Tracing stops here instead of climbing to the filesystem root
  // and pulling in whatever else lives above the checkout.
  outputFileTracingRoot: appDir,

  // Not an optimisation. The logo is imported from this package as an .svg, and
  // Turbopack only wraps an imported image into the { src, width, height }
  // object next/image needs for modules it compiles itself. Left out, the import
  // is a bare URL string, logo.width is undefined, and every render throws
  // "Cannot read properties of undefined (reading 'toString')" while the page
  // still answers 200 with a logo-shaped hole in it.
  transpilePackages: ["@camircode/twofree-ui"],
};

export default nextConfig;
