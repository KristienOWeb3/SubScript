import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"send-slider-interactions.spec.ts",timeout:45_000,workers:1,reporter:"line",outputDir:"../test-results/send-slider-interactions",use:{browserName:"chromium",headless:true,serviceWorkers:"block"}});
