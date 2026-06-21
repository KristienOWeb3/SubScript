function checkoutRequestLogic() {
    return `  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  const baseUrl = process.env.SUBSCRIPT_BASE_URL || "https://subscriptonarc.com";

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

  const response = await fetch(\`\${baseUrl.replace(/\\/$/, "")}/api/intent\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${secretKey}\`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      amountUsdc,
      description,
      externalReference,
      idempotencyKey,
      sandbox: secretKey.startsWith("sk_test_")
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    return { status: response.status, body: payload };
  }

  return {
    status: 200,
    body: {
      intentId: payload.intent.id,
      checkoutUrl: payload.intent.checkoutUrl,
      receiptToken: payload.intent.receiptToken
    }
  };`;
}
export function generateCheckoutRouteTemplate(opts) {
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

async function createSubScriptCheckout(body: any) {
${checkoutRequestLogic()}
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
${checkoutRequestLogic()}
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
${checkoutRequestLogic()}
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
