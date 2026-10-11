import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "transaction-pin.spec.ts", timeout: 60000, workers: 1, reporter: "line", use: { browserName: "chromium", headless: true }, outputDir: "../test-results/transaction-pin" });
