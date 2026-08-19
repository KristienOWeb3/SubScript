/* All code samples shown across the docs, hoisted out of the page so section pages, Markdown
   twins, and tests share one source of truth. Nothing here is executable — it is illustrative
   client/server code that references placeholder values. */

export const quickstartCurl = `curl --request POST \\
  --url https://www.subscriptonarc.com/api/intent \\
  --header "Authorization: Bearer sk_test_your_secret_key" \\
  --header "Content-Type: application/json" \\
  --data '{
    "title": "Order #1042",
    "description": "One-time account activation",
    "amountUsdcMicros": "15000000",
    "externalReference": "order_1042",
    "idempotencyKey": "checkout_order_1042",
    "sandbox": true,
    "successUrl": "https://yourapp.com/billing/success",
    "cancelUrl": "https://yourapp.com/pricing"
  }'`;

export const intentResponseCode = `{
  "success": true,
  "sandbox": true,
  "intent": {
    "id": "clx_intent_123",
    "checkoutSessionId": "clx_intent_123",
    "object": "payment_intent",
    "paymentType": "one_time",
    "appearsInDmPlanPicker": false,
    "title": "Order #1042",
    "amountUsdcMicros": "15000000",
    "status": "PENDING",
    "receiptToken": "rcpt-7e10c918a3aa672eb783f1b965914b12",
    "checkoutUrl": "https://www.subscriptonarc.com/pay/clx_intent_123",
    "chainId": 5042002,
    "usdcAddress": "0x3600000000000000000000000000000000000000"
  }
}`;

export const intentStatusCode = `// Poll when you need a synchronous status check.
// Webhooks remain the source of truth for fulfillment.
const status = await fetch("https://www.subscriptonarc.com/api/intent/clx_intent_123");
const { intent } = await status.json();

if (intent.status === "PAID") {
  // Safe to reconcile dashboards or support views.
  // Fulfillment should still be idempotent and webhook-driven.
}`;

export const checkoutIntentCode = `// Run this on your server: never in a browser component.
const response = await fetch("https://www.subscriptonarc.com/api/intent", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Order #1042",
    amountUsdcMicros: "15000000", // 15 USDC; always an integer string
    description: "One-time account activation",
    externalReference: "order_1042",
    idempotencyKey: "checkout_order_1042",
    sandbox: true,
    successUrl: "https://yourapp.com/billing/success",
    cancelUrl: "https://yourapp.com/pricing",
  }),
});

const payload = await response.json();

if (!response.ok) {
  console.error("SubScript request failed", {
    code: payload.code,
    requestId: payload.request_id,
  });
  throw new Error(payload.message || "SubScript checkout creation failed");
}

// Persist all three beside your own order/user before redirecting.
const checkoutUrl = payload.intent.checkoutUrl;
const intentId = payload.intent.id;
const receiptToken = payload.intent.receiptToken;`;

export const frontendEmbedCode = `// Frontend: open hosted checkout in a new tab so your app keeps its state.
// After settlement, checkout routes the payer back to your successUrl with
// ?subscript_status=success&subscript_checkout_id=...&subscript_receipt_id=...&subscript_tx_hash=...
// (treat those as navigation hints only: confirm payment via webhook or the intent status API).
export function UpgradeButton({ checkoutUrl }) {
  return (
    <a href={checkoutUrl} target="_blank" rel="noopener" className="subscript-button">
      Pay with SubScript
    </a>
  );
}`;

export const subscriptionCode = `const response = await fetch("https://www.subscriptonarc.com/api/v1/subscriptions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Kris's Script Pro",
    amountUsdcMicros: "7000000",
    interval: "weekly",
    subscriber: "0xCustomerWallet...",
    merchantCustomerId: "user_123",
    publishToDm: true,
    idempotencyKey: "sub_user_123_pro_weekly",
    sandbox: true,
  }),
});

const { subscription } = await response.json();

// Redirect to hosted checkout. It becomes active after the customer
// authorizes the bounded recurring payment on-chain.
return redirect(subscription.checkoutUrl);`;

export const subscriptionResponseCode = `{
  "success": true,
  "sandbox": true,
  "subscription": {
    "id": "sub_7f9c5f1e-4a1f-4b4f-bbc1-761b34c0eebb",
    "object": "subscription",
    "status": "incomplete",
    "merchantAddress": "0xMerchant...",
    "subscriptionId": null,
    "subscriber": "0xCustomerWallet...",
    "amountUsdcMicros": "7000000",
    "amountUsdc": "7",
    "intervalSeconds": 604800,
    "intervalCount": 1,
    "interval": "weekly",
    "currentPeriodEnd": null,
    "currentPeriodEndTimestamp": null,
    "nextPaymentDate": null,
    "cancelAtPeriodEnd": false,
    "planId": "b21c8e40-13a7-4a55-9d2c-0f2a9c6f5d18",
    "merchantCustomerId": "user_123",
    "externalReference": "user_123",
    "checkoutUrl": "https://www.subscriptonarc.com/subscribe/7f9c5f1e-4a1f-4b4f-bbc1-761b34c0eebb",
    "expiresAt": "2026-08-20T09:14:00.000Z",
    "createdAt": "2026-08-19T09:14:00.000Z"
  }
}`;

export const subscriptionReconcileCode = `// Reconcile without depending on the webhook. Every read returns your own
// externalReference, the period end, and the on-chain id cancellation needs.
const res = await fetch(
  "https://www.subscriptonarc.com/api/v1/subscriptions?status=active",
  { headers: { Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\` } },
);
const { data } = await res.json();

for (const sub of data) {
  // externalReference is the value you sent as merchantCustomerId.
  // currentPeriodEnd is when access lapses without a renewal — use it
  // rather than deriving createdAt + intervalSeconds.
  await grantAccess(sub.externalReference, { until: sub.currentPeriodEnd });
}

// Retrieve one subscription by the id the list returned. Both id forms work:
// sub_<uuid> for the checkout session, sub_<number> once it is on-chain.
const one = await fetch(
  \`https://www.subscriptonarc.com/api/v1/subscriptions/\${data[0].id}\`,
  { headers: { Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\` } },
).then((r) => r.json());

// Find every subscription for one of your customers.
const forCustomer = await fetch(
  "https://www.subscriptonarc.com/api/v1/subscriptions?externalReference=user_123",
  { headers: { Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\` } },
).then((r) => r.json());`;

export const planCatalogCode = `// Create the reusable tier once. It appears in the merchant dashboard
// and in the plan controls of every existing user DM with this merchant.
const response = await fetch("https://www.subscriptonarc.com/api/v1/plans", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Kris's Script Pro: Weekly",
    amountUsdcMicros: "7000000",
    periodDays: 7,
    description: "Recurring weekly Pro access",
  }),
});

const { plan } = await response.json();

// Later, create a customer checkout against the canonical plan:
await fetch("https://www.subscriptonarc.com/api/v1/subscriptions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    planId: plan.id,
    subscriber: "0xCustomerWallet...",
    merchantCustomerId: "user_123",
    idempotencyKey: "sub_user_123_kris_pro_weekly",
  }),
});`;

export const webhookCode = `import crypto from "crypto";

export async function POST(req) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-subscript-signature");
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;

  if (!secret || !signatureHeader) {
    return Response.json({ error: "Missing webhook configuration or signature" }, { status: 400 });
  }

  const match = signatureHeader.match(/^t=(\\d+),v1=([a-f0-9]{64})$/);
  if (!match) {
    return Response.json({ error: "Malformed signature" }, { status: 401 });
  }

  const timestamp = Number(match[1]);
  const digest = match[2];
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    return Response.json({ error: "Expired signature" }, { status: 401 });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const received = Buffer.from(digest, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // Insert event.id into a UNIQUE column before fulfilling.
  // If it already exists, return 200 without running fulfillment again.
  const inserted = await claimWebhookEvent(event.id);
  if (!inserted) return Response.json({ received: true, duplicate: true });

  if (event.type === "payment.succeeded") {
    await unlockPlanForUser(event.data.intent_id);
  }

  return Response.json({ received: true });
}`;

export const webhookPayloadCode = `{
  "id": "evt_payment_abc123",
  "type": "payment.succeeded",
  "created": 1783080000,
  "data": {
    "intent_id": "clx_intent_123",
    "merchant_reference": "user_123",
    "amount": "15",
    "amount_usdc_micros": "15000000",
    "currency": "USDC",
    "beneficiary_address": "0xbeneficiary...",
    "beneficiaryAddress": "0xbeneficiary...",
    "isSponsored": true,
    "sponsoredPlanId": "plan_123",
    "sponsoredPlanName": "Pro Weekly",
    "durationSeconds": 604800,
    "receipt_id": "rcpt-7e10c918a3aa672eb783f1b965914b12",
    "transaction_hash": "0x...",
    "chain_id": 5042002,
    "usdc_address": "0x3600000000000000000000000000000000000000"
  }
}`;

export const vibePrompt = `You are integrating SubScript into my app.

First classify the billing model. Never choose an endpoint from the product title alone:
- ONE-TIME order, activation fee, invoice, or intentionally non-renewing pass:
  POST /api/intent. It never creates a recurring plan and never appears in DM plan controls.
- REUSABLE recurring weekly/monthly/yearly tier:
  POST /api/v1/plans once, then POST /api/v1/subscriptions with planId.
- CUSTOMER-SPECIFIC recurring offer:
  POST /api/v1/subscriptions with amount + interval + subscriber + merchantCustomerId.

Goal:
- Add the correct SubScript checkout button for my billing model.
- Store the returned resource id and my external account/order reference before redirecting.
- Redirect the user to the returned checkoutUrl.
- Add a webhook route that reads the raw body, verifies the timestamped x-subscript-signature, and atomically claims event.id.
- For one-time payments, fulfill only after payment.succeeded.
- For recurring access, process subscription.created/updated/renewed/payment_failed/canceled.

Use:
- Amount: 15 USDC
- Product: decide whether this is a one-time purchase or a recurring plan before coding
- Webhook path: /api/subscript-webhook
- Env vars: SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET

Important:
- Do not ask the merchant to know the payer wallet.
- Use intent_id only for one-time payments; use planId/subscription_id for recurring billing.
- Never send interval, subscriber, planId, publishToDm, or recurring products to /api/intent.
- Never label a Checkout Intent "weekly", "monthly", or "subscription" unless it is intentionally
  a one-time pass and confirmOneTime: true is supplied.
- Send amountUsdcMicros as an integer string ("15000000" = 15 USDC).
- Use one stable idempotencyKey per logical checkout and reuse it only for retries.
- Never fulfill from the success redirect; fulfill only from the verified webhook.
- Hosted checkout is Arc-native USDC only right now; do not add Base, Solana, or CCTP checkout unless the local docs say it is live.
- Treat fiat onramps, dedicated invoices, sponsor workflows, merchant commitment windows, and Chainlink Automation as deployment-scoped unless the local app explicitly implements them.
- Keep all secret keys server-side only.`;

export const viemMemoCode = `import { parseUnits } from "viem";

const receiptToken = "rcpt-7e10c918a3aa672eb783f1b965914b12";

await walletClient.writeContract({
  address: SUBSCRIPT_ROUTER_ADDRESS,
  abi: [{
    type: "function",
    name: "depositForMerchant",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    outputs: []
  }],
  functionName: "depositForMerchant",
  args: [merchantAddress, parseUnits("15", 6), receiptToken],
});`;

export const meteredUsageCode = `// Merchant backend: check readiness, then ALWAYS call report-usage BEFORE
// you serve the unit of work. report-usage both ACCRUES the charge and tells
// you whether access is allowed: treat any non-200 as "do not serve".
// The customer commits to your vault once; you never collect per call.

const statusRes = await fetch(
  "https://www.subscriptonarc.com/api/user/vault/status?userAddress=0xCustomerWallet...",
  { headers: { Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\` } }
);
const status = await statusRes.json();

if (!status.active) {
  return showCommitPrompt(status.onboarding?.dashboardUrl);
}

const res = await fetch("https://www.subscriptonarc.com/api/user/vault/report-usage", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`, // server-side only
  },
  body: JSON.stringify({
    userAddress: "0xCustomerWallet...",
    amountUsdc: "0.50", // price of this session / unit of work
  }),
});

if (res.status === 402) {
  const body = await res.json();
  // Two "do not serve" cases:
  //  - VAULT_INACTIVE:    owes a balance or dropped below your required commit.
  //  - COMMIT_EXHAUSTED:  this charge would exceed their remaining escrow. The
  //    whole request is rejected: nothing accrues, so a customer can never be
  //    charged past what they committed. body.remainingUsdc tells you what's
  //    left; you may retry with a smaller unit (<= remainingUsdc) if that fits.
  return denySession(body); // ask them to re-commit (or serve a smaller unit)
}

const usage = await res.json();
// 200 == accrued and within escrow: safe to serve.
// usage.active === true, usage.accruedUsageUsdc grows over the 30-day cycle.
grantSession();

// You don't collect per call. At cycle end SubScript's keeper draws the accrued
// total from the customer's escrow; you withdraw it with merchantClaim
// (Merchant dashboard -> Vault, or POST /api/merchant/vault/claim).`;

export const errorEnvelopeCode = `{
  "error": "Bad Request: amountUsdcMicros is required and must be a positive integer in micro-USDC",
  "code": "invalid_amount",
  "message": "Bad Request: amountUsdcMicros is required and must be a positive integer in micro-USDC (e.g. \\"15000000\\" = 15 USDC). amountUsdc is accepted as an alias with the same unit.",
  "request_id": "3f6a1f6e-9d2b-4c1a-8f7e-2b9d4c1a8f7e",
  "doc_url": "https://www.subscriptonarc.com/docs#errors"
}`;
