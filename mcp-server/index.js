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
        description: "Create a one-time payment intent (hosted checkout). Returns a checkoutUrl and intent id. Amount is integer micro-USDC (e.g. 15000000 = 15 USDC).",
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
            sandbox: { type: "boolean" },
          },
          required: ["title", "amountUsdcMicros"],
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
      const { title, amountUsdcMicros, description, externalReference, successUrl, cancelUrl, idempotencyKey, sandbox } = request.params.arguments || {};
      const { status, json } = await callSubscriptApi("/api/intent", {
        method: "POST",
        body: { title, amountUsdcMicros, description, externalReference, successUrl, cancelUrl, idempotencyKey, sandbox },
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

There are two ways to integrate. Hosted checkout is recommended for almost everyone.

## Option A — Hosted checkout (recommended, no contract calls)

Your backend creates a payment intent; the payer completes payment on SubScript's hosted page;
you learn the result by polling status and/or receiving a signed webhook.

1. Create an intent (use the \`create_intent\` tool, or POST /api/intent) with an integer
   micro-USDC amount and your own \`externalReference\`. You get back a \`checkoutUrl\` and an
   intent \`id\`. Send the payer to \`checkoutUrl\`.
2. Poll the \`get_payment_status\` tool (or GET /api/intent/status?id=...) until the status is
   \`PAID\` (other terminal states: \`EXPIRED\`). The payer signs on-chain on the hosted page — you
   never handle keys or calldata.
3. Optionally verify the \`payment.succeeded\` webhook with the \`verify_webhook\` tool before
   granting access. Webhooks are the settlement authority; treat the signature as required.

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
