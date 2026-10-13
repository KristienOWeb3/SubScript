/** Render a sample; --send delivers the user-requested approval preview exactly once per payload. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

async function main() {
    const recipientIndex = process.argv.indexOf("--to");
    const recipient = recipientIndex >= 0 ? process.argv[recipientIndex + 1] : "preview@example.com";
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
        || (process.argv.includes("--send") && recipientIndex < 0)) {
        throw new Error("Use --send --to recipient@example.com to deliver a preview");
    }
    for (const file of [".env", ".env.local"]) {
        if (fs.existsSync(file)) dotenv.config({ path: file, override: true, quiet: true });
    }
    const { buildDepositReceivedEmail } = await import("../src/lib/email/transactional");
    const { sendImmediateEmail } = await import("../src/lib/email/core");
    const email = buildDepositReceivedEmail({
        recipientEmail: recipient, recipientName: "Kristien",
        amountUsdc: "125.50", originChainName: "Arc Network", chainId: 5042,
        referenceId: "design-preview-2026-10-13", receivedAt: new Date("2026-10-13T18:20:15Z"),
    });
    email.subject = "[Preview] Your new SubScript deposit receipt";
    email.text = "Design preview with sample data. No funds moved. Please tell me in our chat whether you approve this design or want any changes.\n\n" + email.text;
    email.html = email.html.replace('<tr><td style="padding:20px;', `<tr><td style="padding:0 4px 20px;font-size:12px;line-height:1.6;color:#526660"><strong>DESIGN PREVIEW</strong><br>Sample data only. No funds moved.<br>Please tell me in our chat if you approve this design or want any changes.</td></tr><tr><td style="padding:20px;`);
    email.idempotencyKey = `deposit-design-preview:${crypto.createHash("sha256").update(`${email.to.toLowerCase()}:${email.html}`).digest("hex")}`;
    const dir = path.resolve(".omx/previews/deposit-email");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "preview.html"), email.html);
    if (process.argv.includes("--send")) {
        const receiptPath = path.join(dir, "send-result.json");
        if (fs.existsSync(receiptPath)) {
            const previous = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
            const legacyKey = `deposit-design-preview:${crypto.createHash("sha256").update(email.html).digest("hex")}`;
            if (previous.recipient?.toLowerCase() === email.to.toLowerCase()
                && [email.idempotencyKey, legacyKey].includes(previous.idempotencyKey)) {
                console.log(JSON.stringify({ alreadySent: true, providerId: previous.providerId }));
                return;
            }
        }
        const providerId = await sendImmediateEmail(email);
        fs.writeFileSync(receiptPath, JSON.stringify({ providerId, idempotencyKey: email.idempotencyKey,
            recipient: email.to, subject: email.subject, acceptedAt: new Date().toISOString() }, null, 2));
        console.log(JSON.stringify({ accepted: true, providerId, recipient: email.to, subject: email.subject }));
    } else console.log(JSON.stringify({ preview: path.join(dir, "preview.html") }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : "Preview failed");
    process.exitCode = 1;
}).finally(async () => {
    const runtime = globalThis as typeof globalThis & { __subscriptPgPool?: { end(): Promise<void> } };
    await runtime.__subscriptPgPool?.end();
});
