import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework, type Framework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { sendTelemetry } from "../utils/api.js";
import { generateCheckoutButtonTemplate } from "../templates/CheckoutButton.js";
import { generateCheckoutRouteTemplate } from "../templates/checkoutRouteTemplate.js";
import { generateEscrowStatusTemplate } from "../templates/EscrowStatus.js";
import { log, fail, recordFile, emitSuccess } from "../utils/output.js";

export async function runAddCheckout(options: { noTelemetry?: boolean; framework?: string; mode?: string }) {
    const cwd = process.cwd();
    const requestId = crypto.randomUUID();
    const generationTimestamp = new Date().toISOString();
    const noTelemetry = !!options.noTelemetry;

    let framework: Framework;
    if (options.framework) {
        framework = options.framework as Framework;
    } else {
        framework = await detectFramework(cwd);
        if (framework === "unsupported") {
            fail({
                code: "framework_not_detected",
                message: "Could not auto-detect a supported framework in this directory (no package.json with react/next).",
                fix: "Pass it explicitly: npx @subscriptonarc/cli add checkout --framework <next-app|next-pages|react-spa|express>.",
            });
        }
    }

    const paths = getProjectPaths(cwd, framework);

    /* The hosted-checkout route is a plain `fetch` to /api/intent — it needs no merchantAddress,
       routerAddress, or chainId, so a subscript.config.ts is optional. When one exists (Privacy
       Premium installs), honor its mode; otherwise default to standard hosted checkout. */
    let mode: "standard" | "privacy-routed" = "standard";
    let merchantAddress = "";
    if (existsSync(paths.configPath)) {
        const configContent = await readFile(paths.configPath, "utf8");
        const merchantMatch = configContent.match(/merchantAddress:\s*["'](0x[0-9a-fA-F]{40})["']/);
        const modeMatch = configContent.match(/mode:\s*["'](standard|privacy-routed|zk-routed)["']/);
        merchantAddress = merchantMatch ? merchantMatch[1] : "";
        const parsedMode = modeMatch ? modeMatch[1] : "standard";
        mode = (parsedMode === "zk-routed" ? "privacy-routed" : parsedMode) as "standard" | "privacy-routed";
    }
    if (options.mode === "standard" || options.mode === "privacy-routed") {
        mode = options.mode;
    }

    log(`[INFO] Scaffolding checkout elements for mode: ${mode}...`);

    await sendTelemetry(
        "cli.addCheckout.started",
        { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, mode, requestId },
        noTelemetry
    );

    try {
        // Generate CheckoutButton.tsx
        const checkoutContent = generateCheckoutButtonTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            mode
        });

        await mkdir(paths.componentsDir, { recursive: true });
        const checkoutBtnPath = path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx");
        await writeFile(checkoutBtnPath, checkoutContent, "utf8");
        recordFile(path.relative(cwd, checkoutBtnPath));
        log(`[SUCCESS] Generated checkout button: ${path.relative(cwd, checkoutBtnPath)}`);

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
            recordFile(path.relative(cwd, paths.checkoutPath));
            log(`[SUCCESS] Generated checkout intent route: ${path.relative(cwd, paths.checkoutPath)}`);
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
            recordFile(path.relative(cwd, escrowPath));
            log(`[SUCCESS] Generated Privacy Premium status tracker: ${path.relative(cwd, escrowPath)}`);
        }

        log("\n[SUCCESS] Checkout component scaffolding completed successfully.");
        log("[INFO] Set SUBSCRIPT_SECRET_KEY in .env.local (Dashboard → Developers → API keys) before creating intents.");

        await sendTelemetry(
            "cli.addCheckout.completed",
            { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, mode, requestId },
            noTelemetry
        );
        emitSuccess({ mode });
    } catch (err: any) {
        await sendTelemetry(
            "cli.addCheckout.failed",
            { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
            noTelemetry
        );
        fail({
            code: "scaffold_failed",
            message: `Add checkout failed: ${err.message}`,
            fix: "Check directory write permissions, then re-run: npx @subscriptonarc/cli add checkout.",
        });
    }
}
