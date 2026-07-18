import type { Framework } from "../utils/framework.js";

export interface CheckoutRouteTemplateOptions {
  cliVersion: string;
  templateVersion: string;
  requestId: string;
  generationTimestamp: string;
  framework?: Framework;
  billingMode?: "one_time" | "subscription";
}

function checkoutRequestLogic(billingMode: "one_time" | "subscription"): string {
  const recurringSetup = billingMode === "subscription"
    ? `
  const intervalSeconds = Number(body?.intervalSeconds || process.env.SUBSCRIPT_INTERVAL || "2592000");
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds <= 0) {
    return { status: 400, body: { error: "intervalSeconds must be a positive integer for subscriptions" } };
  }
  const subscriber = body?.subscriber;
  const merchantCustomerId = body?.merchantCustomerId || body?.externalReference;
  if (merchantCustomerId && !subscriber) {
    return {
      status: 400,
      body: {
        error: "subscriber is required when merchantCustomerId/externalReference is supplied for a subscription"
      }
    };
  }
`
    : "";
  const endpoint = billingMode === "subscription" ? "/api/v1/subscriptions" : "/api/intent";
  const requestBody = billingMode === "subscription"
    ? `{
      title,
      amountUsdc,
      intervalSeconds,
      subscriber,
      merchantCustomerId,
      publishToDm: true,
      idempotencyKey:
        idempotencyKey ||
        \`catalog:\${title}:\${amountUsdc}:\${intervalSeconds}:\${subscriber || "public"}\`,
      sandbox: secretKey.startsWith("sk_test_")
    }`
    : `{
      title,
      amountUsdc,
      description,
      externalReference,
      idempotencyKey,
      confirmOneTime: true,
      sandbox: secretKey.startsWith("sk_test_")
    }`;
  const responseBody = billingMode === "subscription"
    ? `{
      checkoutId: payload.subscription.id,
      subscriptionId: payload.subscription.id,
      resourceType: "subscription",
      checkoutUrl: payload.subscription.checkoutUrl
    }`
    : `{
      checkoutId: payload.intent.id,
      intentId: payload.intent.id,
      resourceType: "payment_intent",
      checkoutUrl: payload.intent.checkoutUrl,
      receiptToken: payload.intent.receiptToken
    }`;

  return `  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  const baseUrl = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";

  if (!secretKey) {
    return { status: 500, body: { error: "SUBSCRIPT_SECRET_KEY is not configured" } };
  }

  const {
    title = process.env.SUBSCRIPT_PLAN_NAME || "SubScript Checkout",
    amountUsdc = process.env.SUBSCRIPT_AMOUNT_USDC || process.env.SUBSCRIPT_AMOUNT_CAP,
    description,
    externalReference,
    idempotencyKey
  } = body || {};

  if (!amountUsdc) {
    return { status: 400, body: { error: "amountUsdc is required" } };
  }
${recurringSetup}

  const response = await fetch(\`\${baseUrl.replace(/\\/$/, "")}${endpoint}\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${secretKey}\`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(${requestBody})
  });

  const payload = await response.json();
  if (!response.ok) {
    return { status: response.status, body: payload };
  }

  return {
    status: 200,
    body: ${responseBody}
  };`;
}

export function generateCheckoutRouteTemplate(opts: CheckoutRouteTemplateOptions): string {
  const billingMode = opts.billingMode || "one_time";
  const header = `/**
 * generatedBy: "SubScript CLI"
 * billingMode: "${billingMode}"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */
`;

  if (opts.framework === "next-pages") {
    return `${header}
import type { NextApiRequest, NextApiResponse } from "next";

async function createSubScriptCheckout(body: any) {
${checkoutRequestLogic(billingMode)}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await createSubScriptCheckout(req.body);
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create SubScript checkout" });
  }
}
`;
  }

  if (opts.framework === "express") {
    return `${header}
import express from "express";

const router = express.Router();

async function createSubScriptCheckout(body: any) {
${checkoutRequestLogic(billingMode)}
}

router.post("/api/subscript/checkout", express.json(), async (req, res) => {
  try {
    const result = await createSubScriptCheckout(req.body);
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create SubScript checkout" });
  }
});

export default router;
`;
  }

  return `${header}
import { NextResponse } from "next/server";

async function createSubScriptCheckout(body: any) {
${checkoutRequestLogic(billingMode)}
}

export async function POST(request: Request) {
  try {
    const result = await createSubScriptCheckout(await request.json());
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to create SubScript checkout" },
      { status: 500 }
    );
  }
}
`;
}
