import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "mobile-nav.spec.ts", timeout: 60000, workers: 1, reporter: "line", use: { browserName: "chromium", headless: true }, outputDir: "../test-results/mobile-nav" });
