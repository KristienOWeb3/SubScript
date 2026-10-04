import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["dashboard-responsive.spec.ts", "dashboard-controls-responsive.spec.ts"],
  timeout: 180000,
  workers: 1,
  reporter: "line",
  use: { browserName: "chromium", headless: true, serviceWorkers: "block" },
  outputDir: "../test-results/dashboard-responsive",
});
