import { defineConfig } from "@playwright/test";

export default defineConfig({testDir: ".", testMatch: "nav-modal-layering.spec.ts", timeout:60_000, workers:1, reporter:"line", outputDir:"../test-results/nav-modal-layering", use:{browserName:"chromium",headless:true,serviceWorkers:"block"}});
