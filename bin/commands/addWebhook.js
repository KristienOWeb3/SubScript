import { writeFile, readFile } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { sendTelemetry } from "../utils/api.js";
import { generateWebhookTemplate } from "../templates/webhookTemplate.js";
export async function runAddWebhook(options) {
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
        if (!paths.hasBackend) {
            throw new Error("Framework structure does not support API routes directly (e.g., React SPA).\n" +
                "Please scaffold webhooks on your server backend instead.");
        }
        if (!existsSync(paths.configPath)) {
            throw new Error(`Configuration file not found at ${paths.configPath}. Please run init command first.`);
        }
        // Parse config settings safely using RegExp
        const configContent = await readFile(paths.configPath, "utf8");
        const merchantMatch = configContent.match(/merchantAddress:\s*["'](0x[0-9a-fA-F]{40})["']/);
        const merchantAddress = merchantMatch ? merchantMatch[1] : "";
        console.log("[INFO] Scaffolding webhook handler endpoint...");
        await sendTelemetry("cli.addWebhook.started", { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId }, noTelemetry);
        // Ensure parent directories exist
        const webhookDir = path.dirname(paths.webhookPath);
        if (!existsSync(webhookDir)) {
            mkdirSync(webhookDir, { recursive: true });
        }
        // Generate route file
        const webhookContent = generateWebhookTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            framework
        });
        await writeFile(paths.webhookPath, webhookContent, "utf8");
        console.log(`[SUCCESS] Webhook handler generated: ${path.relative(cwd, paths.webhookPath)}`);
        console.log(`[IMPORTANT] Ensure you set SUBSCRIPT_WEBHOOK_SECRET in your .env.local file!`);
        await sendTelemetry("cli.addWebhook.completed", { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId }, noTelemetry);
    }
    catch (err) {
        console.error(`\n[ERROR] Add webhook failed: ${err.message}`);
        await sendTelemetry("cli.addWebhook.failed", { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId }, noTelemetry);
        process.exit(1);
    }
}
