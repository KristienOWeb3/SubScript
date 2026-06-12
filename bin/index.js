#!/usr/bin/env node
import { intro, outro, text, select, isCancel, cancel } from "@clack/prompts";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
async function main() {
    intro("@subscript-protocol/create");
    const apiKeyResult = await text({
        message: "Enter your SubScript Merchant API Key (Used for Webhook Verification):",
        placeholder: "your_api_key_here",
        validate(value) {
            if (!value || value.trim().length === 0) {
                return "API Key is required.";
            }
            return;
        },
    });
    if (isCancel(apiKeyResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }
    const apiKey = apiKeyResult;
    const frameworkResult = await select({
        message: "Select your project framework:",
        options: [
            { value: "nextjs", label: "Next.js App Router" },
            { value: "express", label: "Express/Node" },
        ],
    });
    if (isCancel(frameworkResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }
    const framework = frameworkResult;
    /* Install SDK */
    try {
        execSync("npm install @subscript-protocol/sdk", { stdio: "inherit" });
    }
    catch (err) {
        /* Ignore error, allow command output to guide user if needed */
    }
    /* Phase 2: Environment Scaffold */
    await writeFile(".env.local", `SUBSCRIPT_API_KEY=${apiKey}\n`, "utf8");
    await writeFile(".env.example", "SUBSCRIPT_API_KEY=your_api_key_here\n", "utf8");
    /* Agent Context Injection (.cursorrules) */
    const cursorrulesContent = `# SubScript Protocol - Agent Integration Ground Rules
You are operating in a codebase integrating the SubScript Protocol on the Arc Network. You must strictly adhere to the following architectural laws:
1. THE SDK TRUTH: Always use the \`@subscript-protocol/sdk\` package for integrations.
   - Use \`subscript.links.create({ amount_usdc, title, merchant_address })\` for checkout URLs.
   - Use \`subscript.webhooks.verifySignature(rawBody, signature, secret)\` to validate incoming payloads.
2. NON-CUSTODIAL ROUTING: SubScript is entirely stateless. Never suggest creating ephemeral wallets or storing private keys.
3. WEBHOOK IDEMPOTENCY: Always enforce idempotency. Use \`event.paymentLinkId\` to check against the local database before crediting users.
4. SECURITY: Read the API key exclusively from \`process.env.SUBSCRIPT_API_KEY\`. Never hardcode keys.
`;
    await writeFile(".cursorrules", cursorrulesContent, "utf8");
    /* Phase 3: Boilerplate Webhook API Scaffolding */
    if (framework === "nextjs") {
        const webhookPath = "src/app/api/webhooks/subscript/route.ts";
        const webhookDir = path.dirname(webhookPath);
        await mkdir(webhookDir, { recursive: true });
        const nextjsBoilerplate = `import { NextResponse } from "next/server";
import { SubScript } from "@subscript-protocol/sdk";

const subscript = new SubScript({
  apiKey: process.env.SUBSCRIPT_API_KEY || "",
});

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-subscript-signature") || "";
    const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";

    const isValid = subscript.webhooks.verifySignature(rawBody, signature, secret);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    /* TODO: Agent - Implement local database order fulfillment and idempotency checks here */

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
`;
        await writeFile(webhookPath, nextjsBoilerplate, "utf8");
    }
    else {
        const webhookPath = "src/api/webhooks/subscript/route.ts";
        const webhookDir = path.dirname(webhookPath);
        await mkdir(webhookDir, { recursive: true });
        const expressBoilerplate = `import express from "express";
import { SubScript } from "@subscript-protocol/sdk";

const router = express.Router();
const subscript = new SubScript({
  apiKey: process.env.SUBSCRIPT_API_KEY || "",
});

router.post("/api/webhooks/subscript", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const rawBody = req.body.toString();
    const signature = (req.headers["x-subscript-signature"] as string) || "";
    const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";

    const isValid = subscript.webhooks.verifySignature(rawBody, signature, secret);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    /* TODO: Agent - Implement local database order fulfillment and idempotency checks here */

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
`;
        await writeFile(webhookPath, expressBoilerplate, "utf8");
    }
    outro("SubScript SDK and Agent Context successfully injected!");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
