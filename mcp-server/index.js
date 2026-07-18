#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "fs/promises";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const abiPath = join(__dirname, "abi.json");

/* API base + merchant secret key for the transactional tools. Set SUBSCRIPT_SECRET_KEY to an
   sk_test_/sk_live_ key from your dashboard; defaults to the hosted production API. */
const API_BASE = (process.env.SUBSCRIPT_API_BASE || "https://www.subscriptonarc.com").replace(/\/$/, "");
const SECRET_KEY = process.env.SUBSCRIPT_SECRET_KEY || "";
const API_TIMEOUT_MS = Number(process.env.SUBSCRIPT_API_TIMEOUT_MS) || 15000;

async function callSubscriptApi(path, { method = "GET", body } = {}) {
  if (!SECRET_KEY && method !== "GET") {
    throw new Error("SUBSCRIPT_SECRET_KEY is not set. Provide an sk_test_/sk_live_ key to call this endpoint.");
  }
  /* Abort the request if the API stalls, so an MCP tool call can't hang the server. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(SECRET_KEY ? { Authorization: `Bearer ${SECRET_KEY}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/* 1. Initialize the MCP Server */
const server = new Server(
  {
    name: "subscript-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/* 2. Register Tool Listings */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_subscript_config",
        description: "Returns the Arc Network configuration and standard contract addresses for the SubScript protocol.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_subscript_abi",
        description: "Returns the full JSON ABI for the SubScript Router contract required for Wagmi/Viem integration.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_integration_guide",
        description: "Returns the developer integration guide for accepting SubScript payments — hosted checkout (recommended) and direct on-chain router/subscription calls.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_intent",
        description: "Create a ONE-TIME payment intent only. It never creates a recurring plan and never appears in the merchant dashboard/DM plan picker. For weekly/monthly/yearly products use create_plan or create_subscription.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Required. What the payment is for." },
            amountUsdcMicros: { type: "string", description: "Required. Integer micro-USDC, e.g. '15000000'." },
            description: { type: "string" },
            externalReference: { type: "string", description: "Your own order/customer reference (<=256 chars)." },
            successUrl: { type: "string", description: "Optional https URL to return to after payment." },
            cancelUrl: { type: "string", description: "Optional https URL to return to on cancel." },
            idempotencyKey: { type: "string" },
            confirmOneTime: { type: "boolean", description: "Set true only when recurring-looking wording (for example '1 week pass') is intentionally a one-time purchase." },
            sandbox: { type: "boolean" },
          },
          required: ["title", "amountUsdcMicros"],
        },
      },
      {
        name: "create_plan",
        description: "Create a reusable recurring catalog plan. This is the correct tool for a tier such as Pro Weekly or Premium Monthly; the plan appears in the merchant dashboard and user DM plan picker.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Customer-facing recurring plan name." },
            amountUsdcMicros: { type: "string", description: "Recurring charge per billing period in integer micro-USDC." },
            periodDays: { type: "integer", minimum: 1, maximum: 366, description: "Billing period in whole days." },
            intervalSeconds: { type: "integer", minimum: 86400, maximum: 31622400, description: "Alternative custom billing period; do not send with periodDays." },
            description: { type: "string" },
            detailsUrl: { type: "string" },
            minCommitmentDays: { type: "integer", minimum: 0, maximum: 30 },
          },
          required: ["name", "amountUsdcMicros"],
          oneOf: [
            {
              required: ["periodDays"],
              not: { required: ["intervalSeconds"] },
            },
            {
              required: ["intervalSeconds"],
              not: { required: ["periodDays"] },
            },
          ],
        },
      },
      {
        name: "list_plans",
        description: "List this merchant's recurring catalog plans, including whether each plan is active and its DM-visible subscribe URL.",
        inputSchema: {
          type: "object",
          properties: {
            active: { type: "boolean", description: "Optional active-state filter." },
          },
        },
      },
      {
        name: "create_subscription",
        description: "Create a recurring subscription checkout. Use planId for an existing catalog plan, or provide amount plus interval. Products publish to the dashboard/DM picker by default; subscriber-assigned products also create a targeted offer DM.",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "Existing catalog plan id. When supplied, amount and interval come from the plan." },
            amountUsdcMicros: { type: "string", description: "Recurring charge per billing period in integer micro-USDC." },
            interval: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
            intervalSeconds: { type: "integer", minimum: 1 },
            intervalCount: { type: "integer", minimum: 1, maximum: 365 },
            subscriber: { type: "string", description: "Optional target subscriber wallet. Required with merchantCustomerId." },
            title: { type: "string" },
            merchantCustomerId: { type: "string", description: "Merchant-owned customer/account id; requires subscriber." },
            publishToDm: { type: "boolean", description: "Defaults true. Set false only for an intentionally private checkout." },
            idempotencyKey: { type: "string" },
            sandbox: { type: "boolean" },
          },
          oneOf: [
            {
              required: ["planId"],
              not: {
                anyOf: [
                  { required: ["amountUsdcMicros"] },
                  { required: ["interval"] },
                  { required: ["intervalSeconds"] },
                ],
              },
            },
            {
              required: ["amountUsdcMicros"],
              not: { required: ["planId"] },
              oneOf: [
                {
                  required: ["interval"],
                  not: { required: ["intervalSeconds"] },
                },
                {
                  required: ["intervalSeconds"],
                  not: { required: ["interval"] },
                },
              ],
            },
          ],
        },
      },
      {
        name: "get_payment_status",
        description: "Look up a payment intent's status (PENDING/PAID/EXPIRED/...) and on-chain settlement details by intent id.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "The intent id returned by create_intent." } },
          required: ["id"],
        },
      },
      {
        name: "report_usage",
        description: "Report metered usage against a user's vault. Amount is integer micro-USDC (canonical) via amountUsdcMicros.",
        inputSchema: {
          type: "object",
          properties: {
            userAddress: { type: "string", description: "0x-address of the subscriber." },
            amountUsdcMicros: { type: "string", description: "Integer micro-USDC of usage to accrue." },
          },
          required: ["userAddress", "amountUsdcMicros"],
        },
      },
      {
        name: "verify_webhook",
        description: "Verify a SubScript webhook signature (x-subscript-signature: t=...,v1=...) against the raw body and your signing secret. Pure local crypto; no network call.",
        inputSchema: {
          type: "object",
          properties: {
            rawBody: { type: "string", description: "The exact raw request body string." },
            signatureHeader: { type: "string", description: "The x-subscript-signature header value." },
            secret: { type: "string", description: "Your webhook signing secret." },
            toleranceSeconds: { type: "number", description: "Optional clock-skew tolerance (default 300)." },
          },
          required: ["rawBody", "signatureHeader", "secret"],
        },
      },
    ],
  };
});

function verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return { valid: false, reason: "missing signature or secret" };
  const tolerance = Number(toleranceSeconds);
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { valid: false, reason: "invalid tolerance" };
  }
  let timestampStr = "", signature = "";
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") timestampStr = v;
    if (k === "v1") signature = v;
  }
  if (!timestampStr || !signature) return { valid: false, reason: "malformed signature header" };
  const ts = parseInt(timestampStr, 10);
  if (isNaN(ts)) return { valid: false, reason: "invalid timestamp" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > tolerance) {
    return { valid: false, reason: "timestamp outside tolerance" };
  }
  const expected = crypto.createHmac("sha256", secret).update(`${timestampStr}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valid, reason: valid ? "ok" : "signature mismatch" };
}

/* 3. Register Tool Call handlers */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  try {
    if (name === "get_subscript_config") {
      const config = {
        network: "Arc Testnet",
        chainId: 5042002,
        routerAddress: "0x6946B7746c2968B195BD15319D25F67E587CAe3C",
        standardContractAddress: "0x6C574a62F174b7Dc29060200Ab22afc9933FD502",
        usdcAddress: "0x3600000000000000000000000000000000000000",
        explorerUrl: "https://explorer.arc.network",
        apiBase: API_BASE,
        gasToken: "USDC",
        protocolFeeBps: 100, // 1% fee
        amountUnit: "integer micro-USDC (1 USDC = 1000000)",
      };
      return jsonResult(config);
    }

    if (name === "create_intent") {
      const { title, amountUsdcMicros, description, externalReference, successUrl, cancelUrl, idempotencyKey, confirmOneTime, sandbox } = request.params.arguments || {};
      const { status, json } = await callSubscriptApi("/api/intent", {
        method: "POST",
        body: { title, amountUsdcMicros, description, externalReference, successUrl, cancelUrl, idempotencyKey, confirmOneTime, sandbox },
      });
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "create_plan") {
      const args = request.params.arguments || {};
      const { status, json } = await callSubscriptApi("/api/v1/plans", {
        method: "POST",
        body: args,
      });
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "list_plans") {
      const { active } = request.params.arguments || {};
      const query = typeof active === "boolean" ? `?active=${active}` : "";
      const { status, json } = await callSubscriptApi(`/api/v1/plans${query}`);
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "create_subscription") {
      const args = request.params.arguments || {};
      const { status, json } = await callSubscriptApi("/api/v1/subscriptions", {
        method: "POST",
        body: args,
      });
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "get_payment_status") {
      const { id } = request.params.arguments || {};
      const { status, json } = await callSubscriptApi(`/api/intent/status?id=${encodeURIComponent(id || "")}`);
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "report_usage") {
      const { userAddress, amountUsdcMicros } = request.params.arguments || {};
      const { status, json } = await callSubscriptApi("/api/user/vault/report-usage", {
        method: "POST",
        body: { userAddress, amountUsdcMicros },
      });
      return jsonResult({ httpStatus: status, ...json });
    }

    if (name === "verify_webhook") {
      const { rawBody, signatureHeader, secret, toleranceSeconds } = request.params.arguments || {};
      return jsonResult(verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSeconds ?? 300));
    }

    if (name === "get_subscript_abi") {
      const abiContent = await readFile(abiPath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: abiContent,
          },
        ],
      };
    }

    if (name === "get_integration_guide") {
      const guide = `
# SubScript Integration Guide

SubScript settles USDC payments on the Arc Network. USDC is the gas token, and a 1% protocol
fee (100 basis points) is deducted at settlement, so the merchant receives 99%. Amounts are
always integer micro-USDC (1 USDC = 1000000).

Choose the billing resource before writing code:

- A cart order, invoice, activation fee, or single access pass is ONE-TIME: use
  \`create_intent\`. It never appears as a recurring plan in a merchant dashboard or user DM.
- A reusable weekly/monthly/yearly tier is a PLAN: use \`create_plan\`. It appears in the
  merchant dashboard and DM plan picker.
- A checkout that starts recurring authorization is a SUBSCRIPTION: use
  \`create_subscription\`, preferably with a \`planId\`.

Never simulate recurring billing by putting words such as "weekly", "monthly", "subscription",
or "1 week" in an intent title. A title does not create billing terms.

There are two settlement approaches. Hosted checkout is recommended for almost everyone.

## Option A — Hosted checkout (recommended, no contract calls)

Your backend creates a payment intent; the payer completes payment on SubScript's hosted page;
you learn the result by polling status and/or receiving a signed webhook.

1. For a one-time purchase, create an intent (use \`create_intent\`, or POST /api/intent) with an integer
   micro-USDC amount and your own \`externalReference\`. You get back a \`checkoutUrl\` and an
   intent \`id\`. Send the payer to \`checkoutUrl\`.
2. Poll the \`get_payment_status\` tool (or GET /api/intent/status?id=...) until the status is
   \`PAID\` (other terminal states: \`EXPIRED\`). The payer signs on-chain on the hosted page — you
   never handle keys or calldata.
3. Optionally verify the \`payment.succeeded\` webhook with the \`verify_webhook\` tool before
   granting access. Webhooks are the settlement authority; treat the signature as required.

For recurring billing, create the reusable tier with \`create_plan\`, then call
\`create_subscription\` with its \`planId\`. An amount+interval subscription also publishes a plan
by default. Subscriber-assigned subscriptions create a targeted offer DM; public plans are visible
in every existing DM thread with that merchant.

## Option B — Direct on-chain (advanced)

Call the contracts yourself from the payer's wallet. Use \`get_subscript_config\` for the
current router/standard-contract/USDC addresses and \`get_subscript_abi\` for the ABI.

### One-time payment — router \`depositForMerchant\`

Approve USDC to the router, then call \`depositForMerchant(address merchant, uint256 amount,
string memo)\`. Pass the intent's receipt token as \`memo\` so the DepositWithMemo event binds the
payment to your order; SubScript verifies settlement from that event.

\`\`\`typescript
import { useWriteContract } from 'wagmi';
import { parseUnits } from 'viem';

const { writeContractAsync } = useWriteContract();

// 1. approve(routerAddress, amount) on the USDC contract first, then:
await writeContractAsync({
  address: routerAddress,
  abi: routerAbi,
  functionName: 'depositForMerchant',
  args: [merchantAddress, parseUnits('10', 6), receiptToken],
});
\`\`\`

### Recurring subscription — \`createSubscription\`

Call \`createSubscription(address merchant, uint256 amount, uint256 period)\` on the standard
subscription contract (\`standardContractAddress\` from get_subscript_config). The first period
is charged immediately, so approve enough USDC allowance to cover the billing horizon; the
keeper debits each subsequent period against that allowance.

\`\`\`typescript
await writeContractAsync({
  address: standardContractAddress,
  abi: subscriptionAbi,
  functionName: 'createSubscription',
  args: [merchantAddress, parseUnits('10', 6), 2592000n], // 2592000s = 30 days
});
\`\`\`

Metered/usage billing (prepaid vault): the customer commits USDC to a per-merchant vault in the
SubScript app; your backend reports consumption with the \`report_usage\` tool (or POST
/api/user/vault/report-usage) using an integer micro-USDC amount. Usage accrues transparently and
is drawn at cycle end — never more than the customer's committed balance.
      `.trim();

      return {
        content: [
          {
            type: "text",
            text: guide,
          },
        ],
      };
    }

    throw new Error(`Tool ${name} not found`);
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool: ${error.message}`,
        },
      ],
    };
  }
});

/* 4. Start Server */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error running SubScript MCP server:", error);
  process.exit(1);
});
