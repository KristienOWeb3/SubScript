import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".", testMatch: "notification-bell.spec.ts", timeout: 60_000,
    workers: 1, reporter: "line", outputDir: "../test-results/notification-bell",
    use: { browserName: "chromium", headless: true, serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } },
});
