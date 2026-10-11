import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "admin-recovery.spec.ts", timeout: 60_000, workers: 1, reporter: "line", use: { browserName: "chromium", headless: true }, outputDir: "../test-results/admin-recovery" });
