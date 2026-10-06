import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "skeleton-loaders.spec.ts",
  timeout: 60000,
  workers: 1,
  reporter: "line",
  use: { browserName: "chromium", headless: true, serviceWorkers: "block" },
  outputDir: "../test-results/skeleton-loaders",
});
