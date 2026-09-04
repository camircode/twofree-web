import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The browser suites drive a real Chromium against a real `next dev`, so
    // they need Playwright's browsers installed and cost minutes. They run from
    // vitest.browser.config.ts instead, and are excluded here so `pnpm test`
    // stays a fast gate that needs nothing but node_modules.
    exclude: ["**/node_modules/**", "test/**/*.browser.test.ts"],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
