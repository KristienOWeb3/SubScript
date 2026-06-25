# @subscriptonarc/sdk

Typed SubScript API client for Arc USDC payments — payment intents, subscriptions, metered usage, and webhook verification. Zero runtime dependencies (uses native `fetch` and `node:crypto`).

```bash
npm install @subscriptonarc/sdk
```

## Quick start

```ts
import { SubScript, usdc } from "@subscriptonarc/sdk";

const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });

// One-time payment
const intent = await subscript.intents.create({
  title: "Order #1042",
  amountUsdcMicros: usdc(15),            // 15 USDC -> "15000000"
  successUrl: "https://example.com/thanks",
});
console.log(intent.checkoutUrl);

// Subscription
const sub = await subscript.subscriptions.create({
  amountUsdcMicros: usdc(9.99),
  interval: "monthly",
});

// Metered usage
await subscript.usage.report({ userAddress: "0x…", amountUsdcMicros: usdc(0.5) });

// Check status
const status = await subscript.intents.retrieve(intent.id);
```

## Webhooks

```ts
import { SubScript } from "@subscriptonarc/sdk";

const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });

// In your webhook route (rawBody is the unparsed request body string):
const signature = request.headers.get("x-subscript-signature") ?? "";
const event = subscript.webhooks.constructEvent(
  rawBody,
  signature,
  process.env.SUBSCRIPT_WEBHOOK_SECRET!,
);
// throws if the signature is invalid; otherwise returns the parsed event
switch (event.type) {
  case "payment.succeeded": /* … */ break;
  case "subscription.renewed": /* … */ break;
  case "subscription.payment_failed": /* dunning */ break;
  case "subscription.canceled": /* … */ break;
}
```

## API

- `subscript.intents.create(params)` / `.retrieve(id)`
- `subscript.subscriptions.create(params)` / `.retrieve(id)` / `.list({ subscriber })` / `.cancel(id)`
- `subscript.usage.report({ userAddress, amountUsdcMicros })`
- `subscript.webhooks.verify(rawBody, sigHeader, secret)` / `.constructEvent(...)`
- Helpers: `usdc(decimal)` → micro-USDC string, `fromMicros(micros)` → decimal string

All amounts are integer **micro-USDC** (1 USDC = 1,000,000). The full contract is published as an [OpenAPI 3.1 spec](https://www.subscriptonarc.com/openapi.json).

Non-2xx responses throw `SubScriptError` (`.status`, `.body`).
