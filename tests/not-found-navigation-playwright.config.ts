import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".", testMatch: "not-found-navigation.spec.ts", timeout: 30000,
    workers: 1, reporter: "line", use: { browserName: "chromium", headless: true },
    outputDir: "../test-results/not-found-navigation",
});
