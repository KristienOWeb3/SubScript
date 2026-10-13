import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "send-modal-responsive.spec.ts",
    timeout: 60_000,
    workers: 1,
    reporter: "line",
    outputDir: "../test-results/send-modal-responsive",
    use: { browserName: "chromium", headless: true, serviceWorkers: "block" },
});
