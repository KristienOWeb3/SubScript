import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "transaction-pin-loading.spec.ts",
  timeout: 60000,
  workers: 1,
  reporter: "line",
  use: { browserName: "chromium", headless: true, serviceWorkers: "block" },
  outputDir: "../test-results/transaction-pin-loading",
});
