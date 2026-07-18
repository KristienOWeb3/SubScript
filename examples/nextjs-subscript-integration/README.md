# Next.js SubScript integration

This copy-ready App Router example covers every SubScript billing model:

| Use case | Merchant route in this example | SubScript endpoint | Result |
|---|---|---|---|
| One-time payment | `POST /api/subscript/checkout` | `POST /api/intent` | One-time hosted checkout only |
| Public recurring plan | `POST /api/subscript/plans` | `POST /api/v1/plans` | Reusable plan in the dashboard and DM picker |
| User-specific weekly checkout | `POST /api/subscript/subscriptions` | `POST /api/v1/subscriptions` | Targeted recurring checkout with `publishToDm: true` |
| Metered billing | `POST /api/subscript/usage` | `POST /api/user/vault/report-usage` | Usage charged against the user's vault |
| Checkout status | `GET /api/subscript/status/:intentId` | `GET /api/intent/:id` | Pollable settlement and merchant-only delivery health |

Do not send a recurring product to `/api/intent`. A title such as “Pro Plan” or “Monthly
Access” does not create a subscription. Use `/api/v1/plans` or `/api/v1/subscriptions`.

## 1. Copy the files and configure the server

Copy the `app` directory into a Next.js App Router project. Set:

```bash
# .env.local
SUBSCRIPT_SECRET_KEY=sk_test_your_key
SUBSCRIPT_WEBHOOK_SECRET=whsec_your_endpoint_secret
SUBSCRIPT_BASE_URL=https://www.subscriptonarc.com
SUBSCRIPT_TIMEOUT_MS=10000
NEXT_PUBLIC_APP_URL=http://localhost:3000
EXAMPLE_APP_SESSION_SECRET=replace_with_at_least_32_random_characters
```

Despite its conventional Next.js name, `NEXT_PUBLIC_APP_URL` is only a public origin string.
The two secrets must stay server-side and must never use a `NEXT_PUBLIC_` prefix.

Register this receiver in Dashboard → Developers → Webhooks:

```text
https://your-app.example/api/subscript/webhook
```

Store the returned `whsec_…` value as `SUBSCRIPT_WEBHOOK_SECRET`. SubScript shows the full
secret only when the endpoint is created.

## 2. Connect application authentication first

Every example route that can use `SUBSCRIPT_SECRET_KEY` fails closed unless the caller has a
valid merchant-application session. `_lib/applicationAuth.ts` is a dependency-free adapter,
not a second identity system:

- your existing login callback supplies the server-verified application user id, linked wallet,
  and role;
- the adapter signs those server-owned values into an HttpOnly, SameSite cookie;
- checkout, subscription, and usage routes derive identity/wallet from that cookie;
- the plan creation route additionally requires the signed `admin` role; and
- status polling requires both the session and a short-lived token bound to that user and intent.

After your existing login provider has authenticated the user and loaded its database record,
issue the example cookie:

```ts
import { createApplicationSessionCookie } from "@/app/api/subscript/_lib/applicationAuth";

const response = Response.json({ signedIn: true });
response.headers.append(
  "Set-Cookie",
  createApplicationSessionCookie({
    id: databaseUser.id,
    walletAddress: databaseUser.verifiedWalletAddress,
    role: databaseUser.isBillingAdmin ? "admin" : "user",
  }),
);
return response;
```

Never populate these fields directly from a login request body. If you already use Auth.js,
Clerk, Supabase Auth, or another server session, replace only
`requireApplicationUser`/`createApplicationSessionCookie` with that provider's server-side
session lookup and preserve the returned `ApplicationUser` shape.

All upstream calls use a bounded timeout (default 10 seconds, clamped to 1–30 seconds) and
return structured `subscript_timeout`, `subscript_unreachable`, or
`invalid_subscript_response` errors instead of hanging or leaking the merchant secret.

## 3. One-time checkout

Render the included button for a signed-in user:

```tsx
<PayWithSubScriptButton />
```

The server creates a genuinely one-time product (“Workshop ticket”) with
`amountUsdcMicros`, derives the user/order/idempotency values from the verified application
session, and returns `checkoutUrl`. In a real app, persist `intent.id`, `receiptToken`, the
authenticated user id, and your server-owned order id before redirecting the browser.

After settlement, the merchant success URL includes:

```text
subscript_status=success
subscript_verification_status=settled
subscript_checkout_id=...
```

`settled` means SubScript confirmed payment. It does not mean your webhook arrived or your app
fulfilled the order. Never unlock from these browser-controlled query parameters.

For support tooling or recovery, poll:

```http
GET /api/subscript/status/{intentId}?token={statusToken}
```

The checkout response includes `statusToken`. The status proxy requires that token plus the
same authenticated application user before using the merchant key, so one customer cannot
inspect another customer's intent. The response can include transaction proof and the latest
`webhookDelivery` result. Webhooks remain the normal fulfillment path.

## 4. Public recurring plan

Create a reusable weekly tier from an authenticated application-admin action:

```ts
await fetch("/api/subscript/plans", { method: "POST" });
```

The route calls `/api/v1/plans` with `periodDays: 7`. The returned plan appears in the
merchant dashboard and existing merchant/user DM plan pickers. Persist its `plan.id`; future
subscription checkouts can pass that `planId` instead of repeating amount and interval.
The endpoint accepts no financial fields from the browser; name, price, and period are
server-owned constants.

## 5. User-specific weekly subscription

```ts
await fetch("/api/subscript/subscriptions", { method: "POST" });
```

The route uses:

```json
{
  "title": "Kris Script Pro",
  "amountUsdcMicros": "2000000",
  "interval": "weekly",
  "subscriber": "<verified session wallet>",
  "merchantCustomerId": "<verified application user id>",
  "publishToDm": true
}
```

`publishToDm: true` is the important visibility switch. The plan and pending offer are
targeted to the supplied subscriber and appear in that user's merchant DM. Keep
`merchantCustomerId` stable: a later DM upgrade updates the same account's active
subscription. SubScript permits upgrades only; do not build a downgrade control.
The browser cannot override the subscriber, account binding, price, or interval.

## 6. Metered usage

Report the charge before serving a paid unit:

```ts
await fetch("/api/subscript/usage", { method: "POST" });
```

Only perform the metered work after the route returns `200`. On `402`, do not serve the unit:
the customer's vault is inactive or the charge would exceed its remaining commit.
The route bills the verified session wallet at a server-owned unit price; never accept either
value from browser input.

## 7. Signed, idempotent fulfillment

The webhook route:

1. reads the exact raw request body;
2. rejects timestamps outside five minutes;
3. verifies `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` with a constant-time comparison;
4. validates the basic event envelope; and
5. hands the verified event to one merchant database transaction.

Replace `claimEventAndFulfillInMerchantDatabase` with your ORM/database code before launch.
The transaction must claim `event.id` under a UNIQUE constraint and update the entitlement
atomically:

```sql
BEGIN;

INSERT INTO processed_webhook_events (event_id, event_type, processed_at)
VALUES ($1, $2, NOW())
ON CONFLICT (event_id) DO NOTHING;

-- If zero rows were inserted, COMMIT and return 200: this is a safe retry.
-- Otherwise update the order/subscription selected by the signed payload.

COMMIT;
```

Return `2xx` only after the transaction commits. Throw/return `5xx` on database failure so
SubScript retries. Handle `payment.succeeded` and the subscription lifecycle events:
`subscription.created`, `subscription.updated`, `subscription.renewed`,
`subscription.payment_failed`, and `subscription.canceled`.

Malformed, `null`, array, or non-JSON signed bodies receive `400`; they never reach fulfillment.

## 8. Local webhook test flow

Install or invoke the CLI without adding it to the app:

```bash
npx @subscriptonarc/cli trigger payment.succeeded \
  --url http://localhost:3000/api/subscript/webhook
```

Then test real sandbox deliveries:

```bash
npx @subscriptonarc/cli listen \
  --forward-to http://localhost:3000/api/subscript/webhook
```

In the merchant dashboard you can also send `test`, `payment.succeeded`, or
`subscription.created`, inspect the exact HTTP status/response, and replay a stored event.
Replay the same event and verify that your UNIQUE event claim fulfills exactly once.

## 9. Deploy to Vercel

1. Push the merchant app to GitHub and import it in Vercel.
2. Add all environment variables above for Preview and Production. Use `sk_test_…` in Preview.
   Generate a distinct, random `EXAMPLE_APP_SESSION_SECRET` per environment.
3. Deploy, then register `https://your-domain/api/subscript/webhook` in SubScript.
4. Copy the newly returned `whsec_…` into `SUBSCRIPT_WEBHOOK_SECRET` and redeploy.
5. Use “Send test webhook” and confirm a `2xx` response in the SubScript event log.
6. Complete a sandbox checkout, confirm `payment.succeeded`, then replay it and prove
   fulfillment still occurs once.
7. Create separate live API and webhook secrets for Production. Never reuse test secrets.

Success redirects are useful UX, not backend confirmation. Production fulfillment must remain
signed-webhook-driven with status polling as a recovery/debugging tool.
