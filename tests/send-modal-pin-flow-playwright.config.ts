import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"send-modal-pin-flow.spec.ts",timeout:45_000,workers:1,reporter:"line",outputDir:"../test-results/send-modal-pin-flow",use:{browserName:"chromium",headless:true,serviceWorkers:"block"}});
