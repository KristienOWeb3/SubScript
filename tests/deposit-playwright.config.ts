import { defineConfig } from "@playwright/test";

// Standalone modal checks use an esbuild fixture and do not require a Next server.
export default defineConfig({
    testDir: ".",
    testMatch: "deposit-modal.spec.ts",
    timeout: 60000,
    workers: 1,
    reporter: "line",
    use: { browserName: "chromium", headless: true },
    outputDir: "../test-results/deposit-modal",
});
