import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { sendTelemetry } from "../utils/api.js";
import { generateCheckoutButtonTemplate } from "../templates/CheckoutButton.js";
import { generateCheckoutRouteTemplate } from "../templates/checkoutRouteTemplate.js";
import { generateEscrowStatusTemplate } from "../templates/EscrowStatus.js";
export async function runAddCheckout(options) {
    const cwd = process.cwd();
    const requestId = crypto.randomUUID();
    const generationTimestamp = new Date().toISOString();
    const noTelemetry = !!options.noTelemetry;
    try {
        const framework = await detectFramework(cwd);
        if (framework === "unsupported") {
            throw new Error("Framework detection failed. Run init command first.");
        }
        const paths = getProjectPaths(cwd, framework);
        if (!existsSync(paths.configPath)) {
            throw new Error(`Configuration file not found at ${paths.configPath}. Please run init command first.`);
        }
        // Parse config settings safely using RegExp (Phase 3)
        const configContent = await readFile(paths.configPath, "utf8");
        const merchantMatch = configContent.match(/merchantAddress:\s*["'](0x[0-9a-fA-F]{40})["']/);
        const modeMatch = configContent.match(/mode:\s*["'](standard|privacy-routed|zk-routed)["']/);
        const merchantAddress = merchantMatch ? merchantMatch[1] : "";
        const parsedMode = modeMatch ? modeMatch[1] : "standard";
        const mode = (parsedMode === "zk-routed" ? "privacy-routed" : parsedMode);
        if (!merchantAddress) {
            throw new Error("Could not parse merchantAddress from subscript.config.ts");
        }
        console.log(`[INFO] Scaffolding checkout elements for mode: ${mode}...`);
        await sendTelemetry("cli.addCheckout.started", { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, mode, requestId }, noTelemetry);
        // Generate CheckoutButton.tsx
        const checkoutContent = generateCheckoutButtonTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            mode
        });
        const checkoutBtnPath = path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx");
        await writeFile(checkoutBtnPath, checkoutContent, "utf8");
        console.log(`[SUCCESS] Generated checkout button: ${path.relative(cwd, checkoutBtnPath)}`);
        if (paths.hasBackend) {
            await mkdir(path.dirname(paths.checkoutPath), { recursive: true });
            const routeContent = generateCheckoutRouteTemplate({
                cliVersion: CLI_VERSION,
                templateVersion: TEMPLATE_VERSION,
                requestId,
                generationTimestamp,
                framework
            });
            await writeFile(paths.checkoutPath, routeContent, "utf8");
            console.log(`[SUCCESS] Generated checkout intent route: ${path.relative(cwd, paths.checkoutPath)}`);
        }
        // Scaffold status tracker in Privacy Premium modes
        if (mode === "privacy-routed") {
            const escrowContent = generateEscrowStatusTemplate({
                cliVersion: CLI_VERSION,
                templateVersion: TEMPLATE_VERSION,
                requestId,
                generationTimestamp
            });
            const escrowPath = path.join(paths.componentsDir, "EscrowStatusTracker.tsx");
            await writeFile(escrowPath, escrowContent, "utf8");
            console.log(`[SUCCESS] Generated Privacy Premium status tracker: ${path.relative(cwd, escrowPath)}`);
        }
        console.log("\n[SUCCESS] Checkout component scaffolding completed successfully.");
        await sendTelemetry("cli.addCheckout.completed", { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, mode, requestId }, noTelemetry);
    }
    catch (err) {
        console.error(`\n[ERROR] Add checkout failed: ${err.message}`);
        await sendTelemetry("cli.addCheckout.failed", { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId }, noTelemetry);
        process.exit(1);
    }
}
