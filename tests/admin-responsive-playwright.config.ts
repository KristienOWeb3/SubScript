import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "admin-responsive.spec.ts",
  timeout: 180000,
  workers: 1,
  reporter: "line",
  use: { browserName: "chromium", headless: true, serviceWorkers: "block" },
  outputDir: "../test-results/admin-responsive",
});
