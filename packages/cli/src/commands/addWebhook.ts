import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework, type Framework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { sendTelemetry } from "../utils/api.js";
import { generateWebhookTemplate } from "../templates/webhookTemplate.js";
import { log, fail, recordFile, emitSuccess } from "../utils/output.js";

export async function runAddWebhook(options: { noTelemetry?: boolean; framework?: string }) {
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
                fix: "Pass it explicitly: npx @subscriptonarc/cli add webhook --framework <next-app|next-pages|express>.",
            });
        }
    }

    /* Webhook verification only needs the raw body + SUBSCRIPT_WEBHOOK_SECRET — no
       subscript.config.ts required, so this works in a repo that never ran init. */
    const paths = getProjectPaths(cwd, framework);
    if (!paths.hasBackend) {
        fail({
            code: "no_backend",
            message: "This framework structure has no server-side API routes (e.g. a plain React SPA), so a webhook receiver can't live here.",
            fix: "Scaffold the webhook on your backend instead: run 'add webhook --framework express' (or next-app/next-pages) in that repo.",
        });
    }

    log("[INFO] Scaffolding webhook handler endpoint...");

    await sendTelemetry(
        "cli.addWebhook.started",
        { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
        noTelemetry
    );

    try {
        mkdirSync(path.dirname(paths.webhookPath), { recursive: true });

        const webhookContent = generateWebhookTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            framework
        });

        await writeFile(paths.webhookPath, webhookContent, "utf8");
        recordFile(path.relative(cwd, paths.webhookPath));
        log(`[SUCCESS] Webhook handler generated: ${path.relative(cwd, paths.webhookPath)}`);
        log(`[IMPORTANT] Set SUBSCRIPT_WEBHOOK_SECRET in your .env.local (Dashboard → Developers → Webhooks → signing secret).`);

        await sendTelemetry(
            "cli.addWebhook.completed",
            { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
            noTelemetry
        );
        emitSuccess();
    } catch (err: any) {
        await sendTelemetry(
            "cli.addWebhook.failed",
            { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
            noTelemetry
        );
        fail({
            code: "scaffold_failed",
            message: `Add webhook failed: ${err.message}`,
            fix: "Check directory write permissions, then re-run: npx @subscriptonarc/cli add webhook.",
        });
    }
}
