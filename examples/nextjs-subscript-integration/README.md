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
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Despite its conventional Next.js name, `NEXT_PUBLIC_APP_URL` is only a public origin string.
The two secrets must stay server-side and must never use a `NEXT_PUBLIC_` prefix.

Register this receiver in Dashboard → Developers → Webhooks:

```text
https://your-app.example/api/subscript/webhook
```

Store the returned `whsec_…` value as `SUBSCRIPT_WEBHOOK_SECRET`. SubScript shows the full
secret only when the endpoint is created.

## 2. One-time checkout

Render the included button with stable merchant identifiers:

```tsx
<PayWithSubScriptButton userId={session.user.id} orderId={order.id} />
```

The server creates a genuinely one-time product (“Workshop ticket”) with
`amountUsdcMicros`, stores its identifiers, and returns `checkoutUrl`. In a real app, persist
`intent.id`, `receiptToken`, `userId`, and `orderId` before redirecting the browser.

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
GET /api/subscript/status/{intentId}
```

The server-side proxy authenticates as the merchant, so the response can include transaction
proof and the latest `webhookDelivery` result. Webhooks remain the normal fulfillment path.

## 3. Public recurring plan

Create a reusable weekly tier once:

```bash
curl -X POST http://localhost:3000/api/subscript/plans
```

The route calls `/api/v1/plans` with `periodDays: 7`. The returned plan appears in the
merchant dashboard and existing merchant/user DM plan pickers. Persist its `plan.id`; future
subscription checkouts can pass that `planId` instead of repeating amount and interval.

## 4. User-specific weekly subscription

```bash
curl -X POST http://localhost:3000/api/subscript/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "subscriber": "0x1111111111111111111111111111111111111111"
  }'
```

The route uses:

```json
{
  "title": "Kris Script Pro",
  "amountUsdcMicros": "2000000",
  "interval": "weekly",
  "subscriber": "0x...",
  "merchantCustomerId": "user_123",
  "publishToDm": true
}
```

`publishToDm: true` is the important visibility switch. The plan and pending offer are
targeted to the supplied subscriber and appear in that user's merchant DM. Keep
`merchantCustomerId` stable: a later DM upgrade updates the same account's active
subscription. SubScript permits upgrades only; do not build a downgrade control.

## 5. Metered usage

Report the charge before serving a paid unit:

```bash
curl -X POST http://localhost:3000/api/subscript/usage \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x1111111111111111111111111111111111111111",
    "amountUsdcMicros": "25000"
  }'
```

Only perform the metered work after the route returns `200`. On `402`, do not serve the unit:
the customer's vault is inactive or the charge would exceed its remaining commit.

## 6. Signed, idempotent fulfillment

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

## 7. Local webhook test flow

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

## 8. Deploy to Vercel

1. Push the merchant app to GitHub and import it in Vercel.
2. Add the four environment variables for Preview and Production. Use `sk_test_…` in Preview.
3. Deploy, then register `https://your-domain/api/subscript/webhook` in SubScript.
4. Copy the newly returned `whsec_…` into `SUBSCRIPT_WEBHOOK_SECRET` and redeploy.
5. Use “Send test webhook” and confirm a `2xx` response in the SubScript event log.
6. Complete a sandbox checkout, confirm `payment.succeeded`, then replay it and prove
   fulfillment still occurs once.
7. Create separate live API and webhook secrets for Production. Never reuse test secrets.

Success redirects are useful UX, not backend confirmation. Production fulfillment must remain
signed-webhook-driven with status polling as a recovery/debugging tool.
