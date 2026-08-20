# SubScript webhook changes — merchant update

Last updated 2026-08-19. Everything below is live on production unless marked otherwise.

---

## 1. Subscription ids now change on resume and on upgrade

Two flows replace a subscription rather than editing it. Both carry `previous_subscription_id`.

### `subscription.reactivated` (new event)

Fires when a subscriber resumes a subscription they had cancelled, while still inside the period
they had already paid for.

**Nothing is charged at resume.** The subscriber keeps the access they paid for, and the next
charge lands on the original period-end date, on the original cadence. If you report revenue per
event, do not count this one as a payment — no funds move.

```json
{
  "type": "subscription.reactivated",
  "data": { "object": {
    "subscription_id": "sub_42",
    "previous_subscription_id": "sub_37",
    "status": "active",
    "churn_kind": "voluntary",
    "days_since_churn": 0,
    "merchant_customer_id": "your-user-8f21",
    "source_checkout_id": "9c1f…",
    "amount_usdc_micros": "7000000",
    "reason": "Resumed by subscriber inside the paid period; nothing charged"
  }}
}
```

### `subscription.updated` with `previous_subscription_id` (upgrades)

Fires when a subscriber moves to a higher-rate plan by checking out on that plan. The new plan's
whole period is bought today, and the paid-but-unused time on the old plan becomes a discount
against it:

```
credit_applied_usdc_micros = remaining_time * old_amount / old_period
charged today              = new_amount - credit_applied_usdc_micros
```

So the amount that moves is **smaller than the plan price**, and `next_billing_date` is one full new
period from today. A subscriber on 20 USDC/30d who upgrades to 40 USDC/30d on day 15 is charged 30,
not 40, and their next charge is 30 days out.

Upgrades are started by the customer from your own plan page — SubScript's in-app plan list links out
to the `detailsUrl` on each plan and does not switch plans itself. Set `detailsUrl` on a plan (plan
form in the dashboard, or `PATCH /api/v1/plans`) to control where that link goes.

### The one thing to change in your integration

**`subscription_id` changes on both flows.** `previous_subscription_id` tells you which id it
replaces. The underlying authorization is on-chain: it cannot be revived once cancelled, and its
terms cannot be raised in place after a resume, so both necessarily mint a new one.

If you key entitlements on `subscription_id`, an upgraded or resumed customer will look like a
brand-new subscriber and their old record will look abandoned. **Key on `merchant_customer_id`
instead** and treat `subscription_id` as the current authorization, not the customer.

---

## 2. New fields on every subscription event

| Field | What it is |
|---|---|
| `merchant_customer_id` / `external_reference` | The identifier you supplied at creation. The stable key for your side. Both names carry the same value. |
| `source_checkout_id` | The checkout session the subscription came from. |
| `beneficiary` | Present only when the wallet receiving the service differs from the paying wallet. Key entitlements off this when it appears. |
| `pricing` | Present only under introductory pricing. Carries `phase` (`introductory` / `regular`), what was actually charged, the regular price, cycles remaining, and the next charge amount. |
| `environment` / `livemode` | `TEST` or `LIVE`. Reject anything whose environment does not match the key you expect. |

Every field is emitted in **both** `snake_case` and `camelCase` with the same value
(`merchant_customer_id` and `merchantCustomerId`). Pick one; they will not diverge.

---

## 3. Gifted access is a one-time payment, and now says so

A customer with no funds can ask a friend to pay for a plan. The friend pays a single-use checkout,
and **the beneficiary is not the payer** — so `payment.succeeded` is the only event you will ever
receive for it. There is no authorization behind a gift, nothing renews, and no `subscription.*` event
follows.

`payment.succeeded` now states the shape of it outright:

| Field | What it is |
|---|---|
| `is_sponsored` / `isSponsored` | `true` when this payment was a gift. |
| `beneficiary_address` | The wallet to grant access to. **Not** the payer. |
| `sponsored_plan_id` / `sponsored_plan_name` | The plan the gift stands in for. |
| `duration_seconds` | How much access the payment buys. |
| `access_until` | ISO timestamp the window closes — settlement time plus `duration_seconds`. |
| `renews` / `one_time` | `false` / `true`. Stated so a handler cannot mistake a gift for the start of a recurring plan. |

Prefer `access_until` over computing the end date yourself: it is the same value SubScript uses to
warn the beneficiary before their access lapses, so your expiry and ours will agree.

**What to do on your side.** Grant the beneficiary access until `access_until`, and tell them it is
one-time and when it ends — a gifted customer who believes they are subscribed is the one who is
surprised when access stops. If the beneficiary already has access, extend the existing window by
`duration_seconds` rather than rejecting the delivery or creating a duplicate.

SubScript also messages the beneficiary directly: a confirmation naming the payer, the amount, and
the end date, then a `SPONSORED_ACCESS_ENDING` notice before the window closes, with an action to
subscribe for themselves.

---

## 4. Reconciliation API additions

`GET /api/v1/subscriptions` previously returned no way to map a subscription to your own user, and
no period end. Both are fixed.

- **`external_reference` is now returned.** It was accepted at creation but never returned, so the
  webhook was the only place the mapping existed. If a delivery was missed the link was
  unrecoverable.
- **`currentPeriodEnd`** (plus `currentPeriodEndTimestamp`) — when access ends. No need to compute
  `createdAt + intervalSeconds` yourself.
- **`subscriptionId`** — the on-chain id, which is what `DELETE` requires. The list previously only
  exposed the checkout id.
- **`GET /api/v1/subscriptions/{id}`** — new. Accepts either id form. Previously retrieving one
  subscription meant listing all of them and filtering client-side, and the id the list returned was
  rejected by the old `?id=` parameter.
- **Filters:** `?status=active,past_due` and `?externalReference=<your-id>`.
- **New status values:** `past_due`, and `expired` for abandoned checkouts. Abandoned checkouts now
  expire after 24 hours instead of sitting at `incomplete` forever.
- **`status` is now accurate.** It previously reported a cancelled subscription as `active`
  indefinitely, because it was derived from the checkout rather than the live subscription.

---

## 5. Delivery reliability — you may have seen these symptoms

If you were missing events recently, these are the causes, all fixed:

| Symptom | Cause |
|---|---|
| `payment.succeeded` never arrived | Environment was not stamped, so deliveries were dead-lettered. |
| Deliveries failing to resolve your host | A DNS lookup path was not answered correctly. |
| A delivery stuck, never retried | A mid-dispatch error orphaned an already-claimed delivery. |
| Bursts dropped under load | The delivery drain claimed more rows than it could send. |
| All deliveries failing | A dropped database column. |

Signature verification is unchanged: `x-subscript-signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over
`${t}.${rawBody}`, computed on the **raw** body before parsing.

---

## 6. Do not build handlers for these yet

These names appear in the catalog and the endpoint picker, and **nothing emits them today**. A
handler will never fire. They are named so the names cannot be reused, not because they are ready.

```
checkout.canceled          subscription.expired            vault.disputed
checkout.expired           subscription.recovered          vault.dispute_resolved
payment.expired            subscription.trial_converted    vault.pause_requested
payout.pending             subscription.winback_offered    vault.resumed
payout.confirmed           payroll.authorized              vault.settlement_pending
payout.failed              payroll.execution_started
promotion.redeemed         payroll.paused
```

Events that **do** fire today:

- **Payments:** `payment.pending`, `payment.succeeded`, `payment.failed`
- **Checkout:** `checkout.created`, `checkout.completed`
- **Subscriptions:** `activated`, `updated`, `renewed`, `payment_failed`, `cancel_scheduled`,
  `canceled`, `reactivated`, `renewal_upcoming`, `trial_ending`, `allowance_low`
- **Vaults:** `activated`, `topped_up`, `usage_recorded`, `threshold_reached`, `paused`, `settled`,
  `reclaimed`, `service_canceled`
- **Payroll:** `authorization_required`, `execution_succeeded`, `execution_failed`

Two events worth knowing about, distinct from a failed charge:

- `subscription.renewal_upcoming` — advance notice before a charge, not after a failure.
- `subscription.allowance_low` — the spending authorization is running out of cycles. Adding USDC
  does **not** fix this; the subscriber must re-authorize.
