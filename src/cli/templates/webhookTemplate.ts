import type { Framework } from "../utils/framework.js";

export interface WebhookTemplateOptions {
  cliVersion: string;
  templateVersion: string;
  requestId: string;
  generationTimestamp: string;
  framework?: Framework;
}

function commonWebhookHelpers(): string {
  return `type VerificationResult =
  | { ok: true; body: any }
  | { ok: false; status: number; body: { error: string } };

function verifySubScriptWebhook(rawBody: string, signatureHeader: string | null | undefined): VerificationResult {
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, status: 500, body: { error: "SUBSCRIPT_WEBHOOK_SECRET is not configured" } };
  }
  if (!signatureHeader) {
    return { ok: false, status: 400, body: { error: "Unauthorized: Missing signature header" } };
  }

  const match = signatureHeader.match(/t=(\\d+),v1=([a-f0-9]+)/);
  if (!match) {
    return { ok: false, status: 400, body: { error: "Unauthorized: Invalid signature format" } };
  }

  const t = match[1];
  const v1 = match[2];
  const eventTime = Number.parseInt(t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > 300) {
    return { ok: false, status: 400, body: { error: "Unauthorized: Signature expired" } };
  }

  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");

  const expected = Buffer.from(v1, "hex");
  const actual = Buffer.from(computedSignature, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, status: 401, body: { error: "Unauthorized: Signature mismatch" } };
  }

  return { ok: true, body: JSON.parse(rawBody) };
}

function handleVerifiedPayment(body: any) {
  const { event, data } = body;
  if (event === "payment.success") {
    const fulfillmentKey = data?.intent_id || data?.checkout_session_id;
    // TODO: Look up fulfillmentKey in your database, enforce idempotency with body.id,
    // then unlock the matching user/order/subscription exactly once.
    console.log("[INFO] Verified SubScript payment:", fulfillmentKey, data);
  }
}`;
}

export function generateWebhookTemplate(opts: WebhookTemplateOptions): string {
  const header = `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */
`;

  if (opts.framework === "next-pages") {
    return `${header}
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

${commonWebhookHelpers()}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(req);
    const result = verifySubScriptWebhook(rawBody, (req.headers["x-subscript-signature"] as string) || "");
    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }

    handleVerifiedPayment(result.body);
    return res.status(200).json({ received: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to process webhook event" });
  }
}
`;
  }

  if (opts.framework === "express") {
    return `${header}
import express from "express";
import crypto from "node:crypto";

const router = express.Router();

${commonWebhookHelpers()}

router.post("/api/webhooks/subscript", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const result = verifySubScriptWebhook(
      req.body.toString("utf8"),
      (req.headers["x-subscript-signature"] as string) || ""
    );
    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }

    handleVerifiedPayment(result.body);
    return res.json({ received: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to process webhook event" });
  }
});

export default router;
`;
  }

  return `${header}
import { NextResponse } from "next/server";
import crypto from "node:crypto";

${commonWebhookHelpers()}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const result = verifySubScriptWebhook(rawBody, request.headers.get("x-subscript-signature"));
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    handleVerifiedPayment(result.body);
    return NextResponse.json({ received: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process webhook event" },
      { status: 500 }
    );
  }
}
`;
}
