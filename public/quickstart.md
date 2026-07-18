# SubScript Quickstart

Accept your first USDC payment in about five minutes. This is the guided path; for the full
surface see the [API Reference](https://www.subscriptonarc.com/api-reference.md) and the
[OpenAPI spec](https://www.subscriptonarc.com/openapi.json).

## 0. Try it with zero setup (optional)

No account needed for your very first call — a shared, rate-limited sandbox key is published
right here:

```bash
curl -X POST https://www.subscriptonarc.com/api/intent \
  -H "Authorization: Bearer sk_test_demo_subscript_sandbox_2026" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello SubScript", "amountUsdcMicros": "15000000"}'
```

The demo key is sandbox-only (nothing settles), shared with other developers, and rate limited.
When you're ready for your own data, webhooks, and dashboard, create a free key below.

## 1. Get your keys

From your merchant dashboard, copy a **secret key** (`sk_test_…` for sandbox) and create a
**webhook endpoint** to get a signing secret (`whsec_…`). Put them in `.env.local`:

```bash
SUBSCRIPT_SECRET_KEY=sk_test_xxx
SUBSCRIPT_WEBHOOK_SECRET=whsec_xxx
```

`sk_test_` keys never move real funds, so you can run this whole guide safely.

## 2. Install

```bash
npm install @subscriptonarc/sdk
```

Prefer scaffolding? `npx @subscriptonarc/cli add checkout` generates the route below for your
framework, and `add webhook` generates the handler in step 4.

## 3. Create a payment and redirect

Amounts are integer **micro-USDC** (1 USDC = 1,000,000); the `usdc()` helper does the math.
This example is a **one-time order**. `/api/intent` does not create a recurring product and its
result will not appear in the merchant DM plan picker.

```ts
// app/api/checkout/route.ts  (Next.js App Router)
import { SubScript, usdc } from "@subscriptonarc/sdk";

const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });

export async function POST() {
  const intent = await subscript.intents.create({
    title: "Order #1042",
    amountUsdcMicros: usdc(15),                 // 15 USDC
    successUrl: "https://your.app/thanks",
    cancelUrl: "https://your.app/cart",
  });
  // Persist intent.id against your order, then send the user to checkout:
  return Response.redirect(intent.checkoutUrl, 303);
}
```

## 4. Receive and verify the webhook

Always verify the signature against the **raw** request body before trusting a payload.

```ts
// app/api/webhooks/subscript/route.ts
import { SubScript } from "@subscriptonarc/sdk";

const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-subscript-signature") ?? "";
  let event;
  try {
    event = subscript.webhooks.constructEvent(raw, sig, process.env.SUBSCRIPT_WEBHOOK_SECRET!);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  switch (event.type) {
    case "payment.succeeded":
      // event.data.intent_id, event.data.amount_usdc_micros, event.data.transaction_hash
      // Idempotency: skip if you've already credited this intent_id.
      break;
    case "subscription.created":
      // Record the initial subscription lifecycle event; provision only when its status is active.
      break;
    case "subscription.renewed":
    case "subscription.payment_failed":   // dunning
    case "subscription.canceled":
      break;
  }
  return new Response("ok");
}
```

## 5. Poll status when your UI needs it

Webhooks are still the fulfillment source of truth, but support dashboards and AI test loops
can poll an intent directly:

```ts
const intent = await subscript.intents.retrieve("clx_intent_123");
console.log(intent.status); // PENDING | PAID | EXPIRED | EXHAUSTED | INACTIVE
```

## 6. Test it locally — no real payment needed

With your dev server running, send a signed sample event to your handler:

```bash
npx @subscriptonarc/cli trigger payment.succeeded \
  --url http://localhost:3000/api/webhooks/subscript
```

It signs the payload with your `SUBSCRIPT_WEBHOOK_SECRET` (from `.env.local`) so
`constructEvent` verifies it just like production. Try the subscription events too:

```bash
npx @subscriptonarc/cli trigger subscription.renewed --url http://localhost:3000/api/webhooks/subscript
npx @subscriptonarc/cli trigger subscription.payment_failed --url http://localhost:3000/api/webhooks/subscript
```

## 7. Subscriptions (optional)

For a reusable plan that appears in your merchant dashboard and users' DM plan picker, create
the catalog entry first:

```ts
const plan = await subscript.plans.create({
  name: "Pro",
  amountUsdcMicros: usdc(9.99),
  periodDays: 30,
});
```

Then create a subscription checkout from that plan:

```ts
const sub = await subscript.subscriptions.create({
  planId: plan.id,
  subscriber: "0xCustomerWallet...",
  merchantCustomerId: "customer_1042",
  publishToDm: true, // true is already the default
});
// sub.status is "incomplete" until the customer authorizes it on-chain at sub.checkoutUrl.
// Handle subscription.created first, then subscription.renewed on each settled cycle
// (and subscription.payment_failed / subscription.canceled).
```

Use `POST /api/v1/subscriptions` directly when you do not need a reusable catalog entry. API
subscription products publish to the dashboard and DM by default. `merchantCustomerId` keeps the
SubScript subscription tied to your account when the customer upgrades it from the DM. Plan
changes are upgrade-only.

Do not create a “Monthly”, “Weekly”, “Membership”, or “Subscription” product with
`subscript.intents.create()`. A payment intent is always one-time, regardless of its title.

## 8. Usage billing status (optional)

For metered products, check the customer's vault before granting a session, then report usage:

```ts
const status = await subscript.usage.status("0xCustomerWallet...");
if (!status.active) {
  // Send the customer to status.onboarding?.dashboardUrl to commit or re-commit.
}
```

## 9. Go live

Swap `sk_test_` → `sk_live_`, point your webhook endpoint at production, and confirm your
merchant payout wallet is set. That's it.
