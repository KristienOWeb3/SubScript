export interface WebhookTemplateOptions {
  cliVersion: string;
  templateVersion: string;
  requestId: string;
  generationTimestamp: string;
}

export function generateWebhookTemplate(opts: WebhookTemplateOptions): string {
  return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function POST(request: Request) {
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;

  // Refuse startup if webhook secret is missing (Addition 8)
  if (!secret) {
    console.error("[ERROR] Webhook verification failed: SUBSCRIPT_WEBHOOK_SECRET is not configured in env.");
    return NextResponse.json(
      { error: "Internal Server Error: Webhook signature verification secret is not configured" },
      { status: 500 }
    );
  }

  try {
    const signatureHeader = request.headers.get("x-subscript-signature");
    if (!signatureHeader) {
      return NextResponse.json({ error: "Unauthorized: Missing signature header" }, { status: 400 });
    }

    const match = signatureHeader.match(/t=(\\d+),v1=([a-f0-9]+)/);
    if (!match) {
      return NextResponse.json({ error: "Unauthorized: Invalid signature format" }, { status: 400 });
    }

    const t = match[1];
    const v1 = match[2];

    // Replay attack prevention: check timestamp age (max 5 minutes / 300 seconds)
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(t, 10);
    if (isNaN(eventTime) || Math.abs(now - eventTime) > 300) {
      return NextResponse.json({ error: "Unauthorized: Signature expired (replay protection)" }, { status: 400 });
    }

    // Retrieve raw body text to maintain exact byte alignment for hashing
    const rawBody = await request.text();
    const signaturePayload = \`\${t}.\${rawBody}\`;

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(signaturePayload);
    const computedSignature = hmac.digest("hex");

    if (computedSignature !== v1) {
      return NextResponse.json({ error: "Unauthorized: Signature mismatch" }, { status: 401 });
    }

    // Parse the body object
    const body = JSON.parse(rawBody);
    const { event, data } = body;

    // TODO: Process the event and data payload in your application
    console.log("[INFO] Received validated SubScript webhook event:", event, data);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[ERROR] Webhook processing failed:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process webhook event" },
      { status: 500 }
    );
  }
}
`;
}
