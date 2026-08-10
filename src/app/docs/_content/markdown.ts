import { docsSections } from "../_components/sections";
import {
  checkoutIntentCode,
  errorEnvelopeCode,
  frontendEmbedCode,
  intentStatusCode,
  meteredUsageCode,
  planCatalogCode,
  quickstartCurl,
  subscriptionCode,
  subscriptionResponseCode,
  intentResponseCode,
  vibePrompt,
  viemMemoCode,
  webhookCode,
  webhookPayloadCode,
} from "./samples";

/* Plain-Markdown twin of every docs page, served at /docs/<slug>.md.

   An agent reading the HTML pages has to strip Tailwind classes, JSX artefacts, and layout
   chrome to reach the sentences. These carry the same facts with none of that, which is what
   /llms.txt points at. The prose here is deliberately a peer of the page, not a summary — if a
   page gains a constraint or a failure mode, it belongs in both. */

const fence = (language: string, code: string) => `\`\`\`${language}\n${code}\n\`\`\``;

const pages: Record<string, string> = {
  "": `# SubScript Integration Docs — Start here

Create a Checkout Intent from your backend, redirect the payer to SubScript, and fulfill your
order from a signed webhook.

## What SubScript is

SubScript is a payments layer over USDC on Arc. Your backend describes a payment; SubScript hosts
the checkout, watches the chain for settlement, and reports the result over a signed webhook. You
never hold a private key, never map a payer wallet to your user by hand, and never parse a block
explorer.

The mental shift from card processors is small: a Checkout Intent plays the role of a payment
session, the webhook plays the role of the settlement callback, and USDC amounts are integer
micro-units instead of floats.

## Pick the endpoint before writing the request

This is the decision that causes the most rework. Classify the billing model first: does the
customer pay ONCE, or authorize a REPEATING charge?

| Use case | Correct endpoint | Result |
| --- | --- | --- |
| One-time payment | \`POST /api/intent\` | One-time hosted checkout only; never a recurring or DM plan. |
| Public recurring plan | \`POST /api/v1/plans\` | Reusable tier shown in merchant plans, user DMs, and the public subscribe flow. |
| User-specific subscription checkout | \`POST /api/v1/subscriptions\` + \`subscriber\` | Recurring checkout and targeted offer for that user. |
| DM-visible subscription checkout | \`POST /api/v1/subscriptions\` + \`publishToDm: true\` | Recurring product shown in the dashboard and DM plan flow. |
| Metered billing | \`POST /api/user/vault/report-usage\` | Accrues usage against the user's merchant vault. |

\`/api/intent\` is one-time only and never appears in DM plan controls. Recurring-only fields are
rejected by the intent endpoint; recurring-looking titles require \`confirmOneTime: true\`.

Why it is guarded: a Checkout Intent titled "Monthly Pro" that only ever charges once is a support
problem — the customer believes they subscribed and nothing renews. If you hit that error, the fix
is almost always to switch endpoints, not to add the flag.

## Machine-readable surfaces

- Every docs page has a Markdown twin: append \`.md\` to any docs path (\`/docs/webhooks.md\`).
- OpenAPI contract: \`/openapi.json\`
- LLM index: \`/llms.txt\`
- Full agent context: \`/llms-full.txt\`
`,

  quickstart: `# 5-minute quickstart

Your backend creates an intent, your frontend redirects to its hosted checkout URL, and your
webhook fulfills the order after SubScript verifies the Arc settlement. You never need to map a
payer wallet to your user.

## Before you start

A SubScript merchant account and a test API key. No payout wallet, no deployed contract, no funded
account — sandbox keys settle valueless test USDC on Arc Testnet.

1. **Get a test key.** Dashboard → Developers → API keys, create an \`sk_test_\` key. The prefix
   selects the mode, so there is no environment flag to forget.
2. **Keep it server-side.** Save as \`SUBSCRIPT_SECRET_KEY\`. Never prefix with \`NEXT_PUBLIC_\` —
   that ships the key to every browser, and a leaked secret key can create charges.
3. **Choose your order ID.** Use your user/order/invoice ID as \`externalReference\`. It returns in
   the webhook as \`merchant_reference\` and is how you find the right row in your database.

## Step 1 — Create the intent

${fence("bash", quickstartCurl)}

Response:

${fence("json", intentResponseCode)}

Persist these three BEFORE redirecting anyone:

- \`intent.id\` — correlates the webhook back to this checkout.
- \`intent.receiptToken\` — shareable proof handle for support and receipts.
- \`intent.checkoutUrl\` — where the payer goes next.

Write them beside your own order row before the redirect, not after. If your process dies
mid-request, a persisted intent id is the difference between reconciling one payment and hunting
for it.

## Step 2 — The same call from your backend

${fence("javascript", checkoutIntentCode)}

## Step 3 — Send the payer to checkout

${fence("tsx", frontendEmbedCode)}

**The success redirect is not proof of payment.** Checkout appends \`subscript_status=success\` and
friends to your \`successUrl\`. Those are navigation hints a user can type by hand. Treat them as
"show a thank-you page" and nothing more — the signed webhook authorizes fulfillment.

## Step 4 — Fulfill from the webhook

When the payment settles on Arc, SubScript sends a signed \`payment.succeeded\` event. Verify it,
claim the event id so retries cannot double-fulfill, then unlock access. See /docs/webhooks.md.
`,

  concepts: `# Core concepts

Most integration mistakes come from treating identifiers as interchangeable. Give each one a single
job and persist the relationship in your database.

Four ids belong to three different systems: one is yours, two are SubScript's, one belongs to the
delivery layer.

## The four identifiers

- **\`intent.id\`** — SubScript's checkout identifier. Correlates checkout, webhook, receipt, and
  support requests. Arrives in the webhook as \`data.intent_id\`.
- **\`externalReference\`** — your identifier. Your user, order, or invoice ID. Returns as
  \`merchant_reference\`. The only field carrying your domain into SubScript; omit it and every
  webhook forces a lookup by intent id.
- **\`receiptToken\`** — human-readable proof handle. Links hosted checkout to its Arc memo receipt.
  Safe to show a customer; resolves to a receipt page rather than a block explorer.
- **\`event.id\`** — webhook delivery identifier. Store under a UNIQUE constraint before fulfillment
  so retries cannot duplicate work. Belongs to the delivery, not the payment: one payment can
  produce several deliveries of the same event.

## The lifecycle

1. Create intent → \`PENDING\`
2. Redirect payer → hosted checkout
3. Verify settlement → Arc USDC
4. Receive webhook → \`payment.succeeded\`
5. Fulfill once → your database

Your code participates in steps 1 and 5 only.

**Where each step fails.** Step 1: a 4xx means your request was wrong; a 5xx is safe to retry with
the same idempotency key. Step 2: the payer may never arrive — the intent stays \`PENDING\`, so
alert on aged pending intents rather than assuming failure. Step 3: settlement is on-chain and can
lag the browser, which is why the success redirect is not proof. Step 4: deliveries retry; expect
the same event more than once. Step 5: the only step where double-execution costs money or trust —
claim \`event.id\` before doing the work.

## Money units

\`amountUsdcMicros\` is always a positive integer string in six-decimal micro-USDC. \`"15000000"\`
means 15 USDC; \`"1"\` means 0.000001 USDC. Never send floats.

The reason is exactness: \`0.1 + 0.2\` is not \`0.3\` in IEEE-754, and a payments system that rounds
is one that eventually disputes. Multiply by 1,000,000 and send a string. Convert with an
integer-safe helper rather than \`Number(price) * 1e6\`, which reintroduces the float you were
avoiding.
`,

  protocol: `# Protocol brief

The protocol brief translates the feature document into the platform boundary: what is live today,
what problem each flow solves, and what stays caveated until production deployment settings prove
it.

## Why this distinction matters

Payment platforms accumulate two kinds of documentation: what the code does, and what the roadmap
intends. Conflating them is how an integration gets built against a feature not wired up in the
deployment it will run in. When a feature is described as deployment-scoped, treat it as
unavailable until verified in your own environment.

**Live integration primitives:** Checkout Intents, subscriptions, plan catalogs, metered commit
vaults, signed webhooks, receipts, payment links, retries, reconciliation.

**Deployment-scoped targets:** fiat onramps, dedicated invoice terms, sponsor records, merchant
commitment windows, fully decentralized keeper execution.

Full brief: /protocol
`,

  paths: `# Choose a path

All four paths settle the same way and produce the same receipts. They differ in how much of your
own code is involved, and therefore how much automatic fulfillment you get.

**Short version:** if your app has user accounts and you want access to unlock on payment, use the
backend developer path.

## No-code merchant
Create a payment link in the merchant dashboard, copy the URL or QR code, paste it anywhere.
- Choose it when: you need to accept money this week and have no backend to change.
- Where it stops: no automatic fulfillment — you grant access by hand or wire webhooks later.

## Vibecoder
Paste the integration prompt into your coding agent.
- Choose it when: you are building with an AI agent and want it right the first time.
- Where it stops: review the webhook handler yourself; signature verification is what agents most
  often get subtly wrong.

## Backend developer
REST API for Checkout Intents plus a signed webhook route.
- Choose it when: your app has user accounts and entitlements should update automatically.
- Where it stops: nothing meaningful — this is the path the guide is written for.

## Protocol team
Viem/Ethers against SubScript contracts and Arc memo payloads.
- Choose it when: you are building a wallet, agent, or infrastructure that settles on-chain itself.
- Where it stops: you take on settlement verification hosted checkout would do for you.

These are not one-way doors. Starting with a payment link and adding webhook fulfillment later is a
normal progression.
`,

  upa: `# Unified Payment Authorization model

SubScript's UPA model gives one-time payments, subscriptions, usage events, invoices, and AI-native
transactions the same operational shape: a merchant creates a structured authorization, the payer
approves a bounded USDC action, SubScript records the receipt, and signed webhooks tell the merchant
what to unlock.

## Why one shape matters

The code you write for a one-time payment is structurally the code you write for a subscription.
Create an authorization, persist its id beside your own record, redirect, fulfill from a verified
webhook. What changes between billing models is which endpoint you call and which events you
handle — not the architecture.

The word doing the work is *bounded*. A card on file is an open-ended claim on an account; a UPA
authorization is a specific permission with a ceiling the payer approved. That makes surprise
renewals and overdraft-style penalties structurally impossible rather than merely against policy.

- **Consumer control** — users authorize bounded flows and avoid unwanted recurring charges, hidden
  card fees, overdraft-style penalties, and opaque dispute trails.
- **Merchant certainty** — intent IDs, webhook events, retry-aware billing state, payment links, and
  audit-friendly Arc receipt records instead of raw wallet guesswork.
- **Protocol coverage** — Checkout Intents, payment links, metered vaults, signed webhooks, receipts,
  DNS-style aliases, premium privacy flows, retries, reconciliation, keeper-triggered renewals.

## Deployment-scoped

Circle developer-controlled custody, direct fiat-to-USDC onramps, dedicated invoice terms, sponsor
workflows, service lock windows, minimum commitment periods, configurable dunning schedules, and
fully decentralized Chainlink Automation are protocol targets. Google social sign-in is paused until
Circle identity is verified server-side. The current app provides the primitives those build on.
`,

  nocode: `# No-code links

For creators, small SaaS teams, vibe-built products, and early pilots that need payments live
before a full backend integration exists.

1. **Sign up as a merchant** and open the merchant dashboard.
2. **Create a payment link** with amount, title, description, and optional customer reference. The
   reference travels through to the receipt and any webhook you add later.
3. **Copy the URL or QR code.** The QR points at the same hosted checkout URL.
4. **Put it where your customers are** — pricing button, invoice, Discord, email, Linktree.
5. **Get paid.** SubScript records the payment and creates a receipt. Add webhooks later and the
   same events start arriving; the links keep working unchanged.

**Does:** hosts a checkout your payer completes without an account, records the payment, produces a
receipt, and (once configured) sends signed webhooks.

**Does not:** grant access to anything by itself. Fulfillment is yours. Until you wire a webhook,
treat payments as collected and access as something you grant manually.
`,

  vibecoder: `# AI integration prompt

Paste this into your coding agent. The important thing is that your app stores the SubScript
\`intent_id\` beside your own user record and waits for the signed webhook before unlocking access.

## What this prompt defends against

Agents integrate payment APIs from pattern memory, and the memorised patterns are card processors.
Left alone they make four mistakes: pick \`/api/intent\` for a subscription because the title said
"monthly", unlock access from the success redirect, re-serialize the webhook body before verifying
its signature, and put the secret key where the browser can read it.

${fence("prompt", vibePrompt)}

## Review these three things in whatever it writes

1. **The webhook reads raw bytes.** Look for \`await req.text()\`, not \`await req.json()\`. Parsing
   first changes the signed bytes and every signature fails — or worse, the agent "fixes" it by
   skipping verification.
2. **The event id is claimed before fulfillment.** A UNIQUE insert on \`event.id\` that runs before
   the unlock, not an \`if (alreadyProcessed)\` check that races under concurrent retries.
3. **No key reaches the client.** Grep the diff for \`NEXT_PUBLIC_\` near anything named secret or
   webhook.
`,

  developer: `# API reference — Create a Checkout Intent

\`POST /api/intent\`

A Checkout Intent is a single, one-time payment session. It never renews and never appears in DM
plan controls — for recurring billing see /docs/subscriptions.md.

- Base URL: \`https://www.subscriptonarc.com\`
- Authentication: \`Authorization: Bearer sk_test_…\`
- Content type: \`application/json\`

## Request fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| \`title\` | string | Yes | Short one-time purchase name shown at checkout. |
| \`amountUsdcMicros\` | integer string | Yes | Canonical six-decimal amount. \`"15000000"\` = 15 USDC. |
| \`externalReference\` | string ≤ 256 | Recommended | Your user, order, or invoice ID. Returned in the webhook. |
| \`idempotencyKey\` | string | Recommended | Stable key for one logical checkout. Reuse only when retrying that checkout. |
| \`description\` | string | No | Customer-facing context for the payment. |
| \`sandbox\` | boolean | No | Credential-owned test mode. \`sk_test_\` keys set this true. |
| \`successUrl\` | HTTPS URL | No | Where checkout sends the payer after success. Not proof of payment. |
| \`cancelUrl\` | HTTPS URL | No | Where checkout sends the payer after cancellation. |
| \`expiresAt\` | ISO date or Unix time | No | When hosted checkout should stop accepting payment. |
| \`maxUses\` | integer 1–10000 | No | Maximum successful uses for a reusable link. |
| \`confirmOneTime\` | boolean | Only for ambiguous titles | Set true only when wording such as "1 week pass" is intentionally non-renewing. |

\`externalReference\` is your join key — set it to whatever you would search by when a customer
emails support.

\`idempotencyKey\` identifies ONE LOGICAL CHECKOUT, not one HTTP request. Derive it from something
stable in your domain (\`checkout_order_1042\`) so a retried request returns the original intent.
Reusing a key for a genuinely different checkout returns \`409 idempotency_key_conflict\`.

## Creating and redirecting

${fence("javascript", checkoutIntentCode)}

${fence("tsx", frontendEmbedCode)}

## Status polling

Use \`GET /api/intent/:id\` for support tools, dashboards, and agent-driven test loops. The legacy
query form \`GET /api/intent/status?id=...\` remains supported. Anonymous calls return aggregate
status only; pass your \`Authorization: Bearer sk_...\` key (or call from a signed-in dashboard
session) to also receive \`latestPayment\` — payer identity and transaction proof are visible only to
the merchant who owns the checkout. Fulfillment should still happen from the signed webhook.

${fence("javascript", intentStatusCode)}

Polling is for reading; webhooks are for acting. Polling races settlement, costs rate limit, and
gives no delivery guarantee if your process restarts.

## Status codes

- \`201\` Created — a new intent was created.
- \`200\` Replay — the same idempotency key returned its existing intent.
- \`4xx\` Fix request — use \`code\` for branching and \`message\` for display.
- \`5xx\` Retry safely — reuse the same idempotency key and log \`request_id\`.

The \`200\` case is the one people miss: a replay is a success, not a duplicate. Treat 200 and 201
identically.
`,

  subscriptions: `# Subscriptions

\`POST /api/v1/subscriptions\`

SubScript supports fixed-schedule subscription checkouts today. Create a subscription from your
backend, redirect the customer to hosted checkout, and listen for subscription lifecycle webhooks.
Metered vaults are a separate usage-based product, not a workaround for subscriptions.

## Subscription or plan?

A **plan** is a reusable tier ("Pro, 7 USDC, weekly") shown in your dashboard, in customer DMs, and
on public \`/subscribe\` links. A **subscription** is one customer's checkout against that tier.

Fixed pricing page → create plans up front and reference by \`planId\`. Negotiated per customer →
post amount plus interval directly. Posting amount and interval also publishes a companion plan by
default; pass \`publishToDm: false\` when that is not wanted.

Recurring products publish to the merchant dashboard and DM plan picker by default. Supplying
\`subscriber\` creates a targeted plan and offer DM. Customer plan changes are upgrade-only; do not
build or expose a downgrade action.

## Request fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| \`amountUsdcMicros\` | integer string | Yes, unless \`planId\` | Recurring charge amount in micro-USDC. |
| \`planId\` | string | Optional | Use a saved merchant plan for amount and interval. |
| \`interval\` | daily \\| weekly \\| monthly \\| yearly | Yes, unless \`planId\`/\`intervalSeconds\` | Named fixed schedule. |
| \`intervalSeconds\` | integer | Optional | Custom schedule in seconds. |
| \`intervalCount\` | integer | Optional | Multiplier for the interval; defaults to 1. |
| \`subscriber\` | 0x address | Optional | Preselect the expected subscriber wallet. |
| \`merchantCustomerId\` | string ≤ 256 | With \`subscriber\` | Your durable user/account binding. Persists through DM upgrades and webhooks. |
| \`publishToDm\` | boolean | No; defaults true | Publishes the product to dashboard/DM controls. |
| \`idempotencyKey\` | string | Recommended | Stable key for one logical subscription checkout. |

\`merchantCustomerId\` survives plan upgrades — a customer moving Pro → Business gets a new
subscription id but the same \`merchantCustomerId\`, so key entitlements on it rather than the
subscription id.

${fence("javascript", subscriptionCode)}

${fence("json", subscriptionResponseCode)}

## States

- \`incomplete\` — created but not authorized yet. Redirect the customer to \`checkoutUrl\`.
- \`active\` — the customer authorized the recurring payment on-chain. Fulfill from the signed webhook.
- \`canceled\` — unaccepted checkout sessions can be withdrawn by the merchant; active authorizations
  are customer-controlled.

\`incomplete\` is not a failure. Do not grant access on creation, and do not treat a long-lived
incomplete as an error — it usually means checkout is unfinished.

## Lifecycle webhooks

\`subscription.created\`, \`subscription.updated\`, \`subscription.renewed\`,
\`subscription.payment_failed\`, \`subscription.canceled\`.

The CLI sends signed local samples:
\`npx @subscriptonarc/cli trigger subscription.renewed --url http://localhost:3000/api/webhooks/subscript\`

Design \`subscription.renewed\` carefully: it arrives every period, so extending an access window on
each renewal must be idempotent per event id, or one retried delivery grants a free extra period.

## Plan catalog: /api/v1/plans

A subscription checkout and its reusable catalog plan are distinct records. This is the same catalog
the dashboard Plans tab, customer DMs, and \`/subscribe\` links read. \`GET /api/v1/plans\` lists your
plans (each with its shareable \`subscribeUrl\` and any live introductory promotion),
\`POST /api/v1/plans\` creates one (\`name\`, \`amountUsdc\`, \`periodDays\`), and
\`PATCH /api/v1/plans\` updates \`active\`, \`description\`, or \`detailsUrl\`. Pass a plan's \`planId\`
to \`POST /api/v1/subscriptions\` to generate checkouts against it.

${fence("javascript", planCatalogCode)}
`,

  usage: `# Usage billing with commit vaults

\`POST /api/user/vault/report-usage\`

For metered products that do not fit fixed monthly plans, SubScript uses on-chain **commit vaults**.
The platform fixes the commitment at 2 USDC; the customer escrows it once per cycle, and their
service stays active while you report usage. Funds are guaranteed up to the committed balance.

Fits: API and AI token billing, per-session access, pay-per-view items.

## Why not charge per call

Per-call settlement does not work for metered products: a 0.005 USDC inference call cannot carry its
own on-chain transaction, and approving each one is unusable. The approval moves up a level — the
customer authorizes a ceiling once, and you accrue against it. Settlement happens once per 30-day
cycle rather than once per request. \`report-usage\` is an accounting call plus an authorization
check, which is why it is fast enough to sit in front of every unit of work.

## How to integrate

1. **The commitment is platform-fixed.** Every customer escrows the standard 2 USDC per cycle — not
   merchant-configurable (\`GET /api/merchant/vault/commit-config\` returns the policy), and your
   drawable settlement is capped at the same 2 USDC per customer per cycle.
2. **Customer commits once per cycle.** They open \`/dashboard/user?tab=commit\`, choose your merchant
   address, and escrow 2 USDC. The vault goes active for the 30-day cycle; settlement closes it, so
   the next cycle requires a fresh commitment.
3. **Check readiness.** \`GET /api/user/vault/status?userAddress=0x...\` with your secret key returns
   \`NO_VAULT\`, \`VAULT_INACTIVE\`, or \`VAULT_ACTIVE\`, plus a dashboard URL to show the customer.
4. **Report before you serve.** Call \`POST /api/user/vault/report-usage\` BEFORE rendering each unit,
   and serve only on a \`200\`. A \`402\` means do not serve. Reporting after you serve risks eating
   the last unit's cost yourself.
5. **Get paid at cycle end.** SubScript's keeper draws the accrued total from escrow; you withdraw
   with \`merchantClaim\`.

${fence("javascript", meteredUsageCode)}

## The two denial cases

- \`VAULT_INACTIVE\` — the customer owes a balance or dropped below the required commit. Send them to
  \`status.onboarding?.dashboardUrl\`.
- \`COMMIT_EXHAUSTED\` — this charge would exceed remaining escrow. The entire request is rejected and
  NOTHING ACCRUES, so a customer can never be charged past what they committed.
  \`body.remainingUsdc\` shows what is left; retrying with a smaller unit is valid.

Because an over-ceiling charge is rejected whole rather than partially applied, the committed amount
is a true maximum: no dunning, no negative balance, no surprise invoice.

## Readiness check versus usage report

\`GET /api/user/vault/status\` is a cheap read for rendering UI. It is not an authorization. Check
status to decide what to render; call \`report-usage\` to decide what to serve.

Keep \`SUBSCRIPT_SECRET_KEY\` server-side only. Usage accrues off-chain during the cycle and settles
on-chain at cycle end. Direct bank-transfer fiat-to-USDC funding remains provider/compliance-scoped
until a live onramp is wired.
`,

  webhooks: `# Webhooks

A redirect says where the browser went. A signed webhook says what settled. Read the raw request
bytes, verify the timestamped HMAC, claim the event ID atomically, and only then update your order
or entitlement.

## Threat model

Your webhook endpoint is a public URL that grants access when called. Without verification, anyone
who learns it can POST a fake \`payment.succeeded\`. The HMAC proves the message came from SubScript;
the timestamp stops replay of a captured-but-genuine event; the event-id claim stops an honest retry
from delivering twice. All three are load-bearing.

## The four steps

1. **Read raw body** — parsing and re-serializing JSON changes the signed bytes.
2. **Check ±5 minutes** — reject stale timestamps before computing trust.
3. **Verify HMAC** — sign timestamp + period + exact raw body with SHA-256.
4. **Claim event.id** — a UNIQUE insert makes retries safe under concurrency.

Step 1 is where most integrations break. In most frameworks the body is already parsed by the time
your handler runs, and \`JSON.stringify(req.body)\` does not reproduce the original bytes — key
order, whitespace, and unicode escaping all shift. In Next.js App Router use \`await req.text()\`; in
Express use \`express.raw()\` on that route specifically.

## A complete handler

Note \`crypto.timingSafeEqual\` instead of \`===\`, which prevents discovering a valid signature one
byte at a time by measuring response latency.

${fence("javascript", webhookCode)}

Keep \`SUBSCRIPT_SECRET_KEY\` and \`SUBSCRIPT_WEBHOOK_SECRET\` server-side only. Never expose either
in React props, mobile clients, public repositories, browser bundles, logs, or screenshots.

## The event payload

Canonical event: \`type: "payment.succeeded"\`. Use \`data.intent_id\` to find the SubScript checkout
and \`data.merchant_reference\` to find your own user or order. The legacy \`event: "payment.success"\`
alias exists only for compatibility.

${fence("json", webhookPayloadCode)}

## Sponsored payments — credit the beneficiary, not the payer

A user with zero balance can request plan sponsorship via
\`POST /api/user/requests/merchant-plan\` (accepting \`sendDirectMessage: true\` and \`targetPeer\`),
dispatching a \`SPONSORED_PLAN_REQUEST\` card in the User A ↔ Friend B DM thread. The single-use
checkout is a one-time gift payment for the plan's regular price and one billing duration.

On payment, SubScript dispatches a \`SPONSORED_PLAN_CONFIRMED\` Merchant DM to User A with a
\`resubscribePlanId\` payload. In \`payment.succeeded\`, check \`data.isSponsored\`,
\`data.beneficiary_address\`, \`data.sponsoredPlanId\`, and \`data.durationSeconds\`. Credit the
beneficiary, not necessarily the payer. If the beneficiary already has active access, extend the
existing window by \`durationSeconds\` instead of rejecting the webhook or creating a duplicate.

## Delivery behavior

- Return any \`2xx\` only after the event is durably claimed.
- SubScript retries timeouts, \`408\`, \`429\`, and \`5xx\`. Each attempt is logged on a best-effort
  basis with its HTTP status and response body.
- Your handler must return \`200\` for an already-processed \`event.id\`.
- Do slow email, analytics, or provisioning work after the durable claim, preferably via your queue.
- The merchant dashboard shows delivery attempts per event on a best-effort basis.

Every webhook is recorded in the \`merchant_events\` ledger before dispatch. Attempts are logged to
\`webhook_delivery_attempts\`; rows may be missing if persistence fails after the HTTP request.
Endpoints are environment-scoped (\`TEST\` or \`LIVE\`) so sandbox and production traffic never cross.
Secret rotation supports a grace-period overlap — the previous signing secret stays valid until it
expires.

**Delivery health APIs.** Signed-in Premium merchants can inspect \`GET /api/webhooks/endpoints\` and
\`GET /api/webhooks/events\` (cursor pagination, \`?type=\` / \`?environment=\` filters), resend with
\`POST /api/webhooks/events/replay\`, or send a signed sample through \`POST /api/webhooks/test\`.
Test event types are \`test\`, \`payment.succeeded\`, and \`subscription.created\`. Send
\`{ "latest": true }\` to the replay endpoint for one-click "Resend latest".
`,

  testing: `# Test & debug

Build the complete test flow before swapping credentials. Test and live modes use the same API
shape, so your code should change configuration: not logic.

## Mode comes from the credential

There is no environment switch and no staging URL. An \`sk_test_\` key implies \`sandbox: true\` on
everything it touches. The one thing to get right in deployment is which key is in the environment —
which is why the key belongs in secret storage, not a config file copied between environments.

| Mode | Credential | Behavior | Use it for |
| --- | --- | --- | --- |
| Arc Testnet | \`sk_test_…\` | Implies \`sandbox: true\`, settles valueless test USDC on Arc Testnet. The shared public demo key is simulation-only. | Funded testnet integration, CI, end-to-end settlement tests. |
| Live | \`sk_live_…\` | Requires a configured merchant payout wallet. | Real customer settlement after launch review. |

## Testing without waiting for real events

- Local signed event: \`npx @subscriptonarc/cli trigger payment.succeeded --url http://localhost:3000/api/webhooks/subscript\`
- Forward real test events: \`npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks/subscript\`
- Simulate renewals: \`POST /api/test/clocks\`, attach a subscription, then \`POST /api/test/clocks/:id/advance\`

Test clocks are the only practical way to verify annual renewals, dunning behavior, and access
expiry before real time passes.

## Sandbox acceptance checklist

- Create an intent and persist all identifiers before redirect.
- Complete checkout and receive \`payment.succeeded\`.
- Replay the same webhook and prove fulfillment happens once.
- Retry intent creation with the same \`idempotencyKey\` and receive the same intent.
- Send an invalid amount and confirm your logs capture \`request_id\`, never the secret key.

## Go-live checklist

- Create a separate \`sk_live_\` key and store it only in server secrets.
- Configure and verify the merchant payout destination.
- Use a distinct live webhook endpoint secret.
- Alert on webhook 5xx responses and aged \`PENDING\` intents.
- Keep the funded Arc testnet path available for release regression tests.

The replay test is the one that matters: everything else confirms the happy path. Replaying a
processed webhook proves your idempotency works, and that is the failure that costs real money.

## Fast diagnosis

- \`401 unauthorized\` — confirm the Bearer header exists and the key is active. Do not print the key.
- \`400 invalid_amount\` — send a positive integer string in micro-USDC; never \`15.00\`.
- \`409 idempotency conflict\` — the key belongs to another logical resource. Generate a new key.
- \`merchant_payout_wallet_missing\` — live key valid, but live checkout blocked until payout setup.
- Webhook signature mismatch — verify against the raw body before JSON parsing, and use the
  endpoint's exact secret.
`,

  errors: `# Error responses

Every non-2xx response carries a machine-readable envelope. Branch on \`code\` (stable identifier),
show \`message\` to humans, and quote \`request_id\` when contacting support: server logs are indexed
by it.

\`message\` is written for people and can change wording without notice. \`code\` is the stable
contract your code branches on. \`request_id\` is the forensic key — support can retrieve the exact
request without asking you to reproduce anything.

${fence("json", errorEnvelopeCode)}

## Common codes

- \`unauthorized\` — missing/invalid \`Authorization: Bearer sk_…\` header. Keys live in Dashboard →
  Developers → API keys.
- \`invalid_json\` — request body is not valid JSON.
- \`missing_title\` / \`invalid_amount\` — validation failures return \`400\` with the field named in
  \`message\`.
- \`merchant_payout_wallet_missing\` — live key with no payout wallet configured; \`resolution_url\`
  points at the settings page.
- \`quota_exceeded\` — active-link tier limit reached (\`403\`).
- \`idempotency_key_conflict\` — the key was already used for a different resource (\`409\`).
- \`internal_error\` — a \`500\` with no internals leaked; report the \`request_id\`.

Two deserve a policy decision: \`idempotency_key_conflict\` means your retry logic drifted — surface
it loudly. \`merchant_payout_wallet_missing\` only appears on live keys; seeing it in test means a
live key leaked into a test environment.
`,

  receipts: `# Receipts

SubScript receipts are designed for humans, not explorers. A payer can share a URL like
\`www.subscriptonarc.com/receipt/rcpt-7e10c918a3aa672eb783f1b965914b12\`, while SubScript indexes the
Arc memo and displays amount, sender, merchant, date, note, and transaction status.

## Why not just link the block explorer

A block explorer answers "did this transaction happen". It does not answer "what did I buy, from
whom, and for what". The receipt page carries the commercial context while the Arc memo underneath
keeps it verifiable.

- **Default visibility** — receipt data is intended for the payer, merchant, and SubScript by
  default. Future invite flows can selectively disclose a receipt to another viewer.
- **Proof without confusion** — the receipt page hides raw transaction complexity while preserving
  auditability through Arc memo indexing.

## Working with receipt tokens

The \`receiptToken\` comes back when you create an intent and again in the webhook as
\`data.receipt_id\`. Persist it beside your order: surface it in order history, attach it to a
confirmation email, or hand it to support when a customer disputes a charge.

Checkout returns the payer to your \`successUrl\` with \`subscript_status\`,
\`subscript_checkout_id\`, \`subscript_receipt_id\`, and \`subscript_tx_hash\`. Those are navigation
hints over a channel the browser controls — fine for rendering a thank-you page or linking to the
receipt, never sufficient for granting access.
`,

  contracts: `# On-chain — Arc memo transaction payload

Merchant hosted links settle through the SubScript Router: the receipt token is passed as the router
memo, and the backend verifies the matching \`DepositWithMemo\` event before marking the payment
paid. User-created receive links settle as direct Arc USDC transfers to the requester, with the
backend verifying the ERC-20 \`Transfer\` call and event. Cross-chain CCTP checkout is disabled for
hosted payment links until Arc-side mint and memo settlement can be verified in one bound flow.

## Why the memo matters

A bare USDC transfer to a merchant address is ambiguous — several customers can pay identical
amounts in the same block, and nothing on-chain says which checkout each settles. The receipt token
travels as the router memo, letting settlement verification bind a specific transfer to a specific
intent rather than guessing by amount and timing.

This is why the two link types verify differently: a router deposit carries the memo and is matched
on \`DepositWithMemo\`, while a direct receive-link transfer has no memo and is matched on the ERC-20
\`Transfer\`.

${fence("typescript", viemMemoCode)}

Most integrations should not do this. Calling the router directly means you own settlement
verification, memo correctness, gas, and failure recovery. Reach for this path when building a
wallet, an autonomous agent, or infrastructure that must construct its own transactions.
`,

  faq: `# FAQ

## Getting started

**How easy is integration?** A no-code merchant can launch with a hosted link in minutes. A
developer can add intent creation and webhook fulfillment in under an hour if their app already has
user accounts.

**Can I test before setting a payout wallet?** Yes. Use a \`sk_test_\` key to settle valueless test
USDC on Arc Testnet. The shared public demo key remains simulation-only. Live keys require a
configured payout destination and return \`merchant_payout_wallet_missing\` if setup is incomplete.

**Does the merchant need to track wallets?** No. Track Checkout Intent IDs. SubScript maps wallet
payment activity to the off-chain intent and sends the signed result.

## Billing models

**Can SubScript handle usage-based products?** Yes. Commit vaults let a customer escrow the
platform-fixed 2 USDC commitment once per cycle; the merchant reports API calls, tokens, sessions,
or per-item access via the usage API, which accrues the charges and gates access. SubScript draws
the accrued total from escrow at cycle end, closes the vault, and requires a fresh commitment for
the next cycle.

**Can someone else sponsor a subscription?** The protocol model supports sponsored payment
relationships such as parents, employers, or teams covering costs while keeping the subscriber's
usage context separate. Dedicated sponsor records, spending caps, and revocation policies are still
deployment-scoped.

**Does SubScript provide invoices?** The current product supports payment links, Checkout Intents,
receipt records, and external references that cover invoice-like collection. A dedicated invoice
engine with custom due terms is documented as a protocol target.

## Money, fees, and comparisons

**What does the user pay?** The advertised USDC price. SubScript is designed around predictable Arc
USDC gas and sponsored-fee flows so users avoid hidden card-style fees.

**Why is this better than dollar cards?** Users avoid virtual card setup fees, maintenance fees,
failed transaction penalties, KYC delays for basic wallet setup, billing-address failures, and FX
markup surprises.

**What problem does SubScript solve?** It prevents unwanted recurring charges, double-billing,
hidden cancellation traps, overdraft-style penalties, and opaque receipt disputes by moving billing
state into transparent programmable payment logic.

**How does SubScript compare to streaming payment protocols?** SubScript uses Permit2-style bounded
allowances rather than continuous locked streaming liquidity, so funds can remain liquid in the
user's wallet until a billing-cycle transaction executes.

## Custody and accounts

**Can users export their wallet key?** Legacy email wallets can be exported only after fresh OTP
step-up verification. Circle developer-controlled MPC wallets do not expose a raw private key.
Google sign-in is paused until its identity and custody flow is verified server-side.

## Roadmap and deployment scope

**Can merchants enforce lock windows?** The UPA model includes service lock windows, minimum
commitments, and grace periods, with a ceiling of 72 hours for digital goods and 30 days for SaaS
seats. These terms need explicit schema, contract enforcement, and UI disclosure before live use.

**Does SubScript have smart dunning?** The platform has retry, reconciliation, billing, and
notification primitives. Configurable Day 1, Day 3, and Day 7 schedules plus email/SMS top-up
reminders should be formalized before calling it fully live.

**Does SubScript use decentralized keepers?** The codebase has keeper-compatible contract and API
surfaces today. Full Chainlink Automation as the default execution network should be treated as a
roadmap or deployment configuration item until the production keeper network is wired.
`,
};

/** Markdown twin for a slug, with a shared footer pointing at the canonical HTML page. */
export function markdownForSlug(slug: string): string | null {
  const body = pages[slug];
  if (body === undefined) return null;

  const section = docsSections.find((entry) => entry.slug === slug);
  const canonical = slug ? `https://www.subscriptonarc.com/docs/${slug}` : "https://www.subscriptonarc.com/docs";
  const title = section ? section.title : "SubScript Docs";

  return `${body}
---
Canonical HTML: ${canonical}
Section: ${title}
All docs pages are available as Markdown by appending .md to the path.
Index: https://www.subscriptonarc.com/llms.txt
`;
}

export const markdownSlugs = Object.keys(pages);
