# Email audit: what's wired up, and everywhere email should be sent

Audit of `src/lib/email/transactional.ts` (the entire email layer — 448 lines, one file) against every lifecycle moment in the product.

**Provider:** Resend. **Templates:** 8. **Call sites:** 7. **Lifecycle events the system already defines:** 58.

**Status key:** ✅ built and called · 🟡 partial or built-but-unreachable · ❌ not present

---

## Part 1 — What exists today

### 1.1 The eight templates

| Template | Called from | Audience |
| --- | --- | --- |
| `sendAuthenticationCodeEmail` | `api/auth/otp/send` | User signing in |
| `sendSignInAlertEmail` | **nowhere** | — |
| `sendWelcomeEmail` | `api/auth/register-role` | New user or merchant |
| `sendPaymentReceiptEmails` | `lib/payments/paymentLinkVerificationWorker` | Payer + merchant |
| `sendSubscriptionCancellationReasonEmail` | `api/user/dms` | Merchant |
| `sendPlatformFlagChangeEmail` | `api/admin/flags` | All platform admins |
| `sendMerchantAccessGrantedEmail` | `api/admin/merchant-access` | Approved business |
| `sendSupportTicketAlertEmail` | `api/support/tickets` | All platform admins |

### 1.2 What the infrastructure gets right

Worth stating plainly, because this part is careful work:

- **Idempotency keys on every send.** And `sendSignInAlertEmail` hashes the recipient before putting it in the key, so recipient PII never lands in the provider-visible `Idempotency-Key` header. That's a detail most teams miss.
- **HTML escaping on every interpolated value**, including the OTP code itself.
- **Table-based, inline-styled layout** with a documented reason (Gmail and Outlook strip `<style>` blocks and flexbox), and a font stack that degrades to system sans because web fonts don't load in mail clients.
- **Errors logged without recipient addresses or body content.**
- **Anti-enumeration on OTP** — the response is always "if this email can sign in, a code has been sent."
- **`EMAIL_FROM` throws in production** if unset rather than falling back to a test sender. Correct direction.
- **The cancellation-reason email respects "prefer not to answer"** — a non-reason code is a no-op, so the merchant is never told something the customer chose to withhold.
- **Payment receipts dedupe** when payer and merchant share an address.

---

## Part 2 — Infrastructure findings

**1. The sign-in alert never fires.** `sendSignInAlertEmail` is defined, complete, and imported by nothing. Grep across `src/` returns only its own definition. So the one security notification you built doesn't exist at runtime.

**2. Payment receipts only fire for payment links.** The sole call site for `sendPaymentReceiptEmails` is `paymentLinkVerificationWorker.ts`, which is reached only from `api/cron/reconcile` and `api/payment-links/verify`. Subscription charges, one-time checkout intents, vault settlements, batch payouts, and peer-to-peer transfers all settle without emailing anyone. The header comment in `lib/subscriptions/webhookDelivery.ts` confirms the shape of this: payments "flush inline at settlement (paymentLinkVerificationWorker, payment-links/verify)" and nothing else does. This is the largest functional gap in the system — most payments produce no email.

**3. Over-limit emails are silently dropped.** `assertProviderRateLimit` throws `ProviderRateLimitError`; `safelySendEmail` catches everything and logs; there's no queue and no retry. The per-recipient limit is **5 emails per hour, shared across every email type.** So a user who requests three codes and receives two receipts has hit the cap, and their next verification code vanishes while the UI says it was sent. On the OTP path this is worse than a visible failure, because the account holder can't tell they're locked out or why.

**4. No outbox.** Webhooks get `webhookOutbox` with durable retry. Emails get fire-and-forget inside `after()`. Same platform, same reliability requirement, opposite treatment — and email is the channel carrying login codes.

**5. No bounce or complaint handling.** There's no Resend webhook route anywhere under `src/app/api`. Nothing records a hard bounce, nothing suppresses a dead address, nothing reacts to a spam complaint. Sending repeatedly to dead addresses is how a sending domain's reputation degrades, and by the time you notice, the codes stop arriving for everyone.

**6. No unsubscribe path.** No `List-Unsubscribe` header, no unsubscribe URL in the footer — just the line "You're receiving this because your email is linked to a SubScript account." Gmail and Yahoo both weight one-click unsubscribe in bulk-sender reputation, and the welcome email is arguably promotional.

**7. `emailEnabled` is one boolean.** A user who mutes email to stop receipts also mutes security alerts and payment failures. You need at least four categories: security (not optional), transactional receipts, lifecycle reminders, and marketing. Right now the toggle is all-or-nothing and it gates receipts.

**8. Fifty-eight events, eight emails.** `src/lib/events/types.ts` already enumerates the whole product lifecycle — `subscription.renewal_upcoming`, `payment.failed`, `vault.threshold_reached`, `payout.failed`, `payroll.execution_failed`, and 53 more. The taxonomy is done. The email layer was just never built against it. Most of Part 3 is wiring, not design.

**9. Dunning sends nothing.** `api/merchant/dunning` runs queries and dispatches no notification. The product brief promises "automated email/SMS or webhook-triggered top-up reminders" as part of the smart dunning engine. Failed payments currently recover only if the customer happens to open the app.

**10. In-app DMs cover ~19 message types; email covers 8.** DMs already handle `RENEWAL_UPCOMING`, `TRIAL_ENDING`, `ALLOWANCE_LOW`, `SPONSORED_ACCESS_ENDING`, `WINBACK_OFFER` and more. That's a genuinely good in-app channel — but it only reaches people who open the app, which is the opposite of the set-and-forget user you're designing for. Email is the channel for someone who hasn't logged in for three months.

---

## Part 3 — Everywhere email should be sent

### 3.1 Auth and account security → the account holder

| Trigger | Status | Notes |
| --- | --- | --- |
| Verification code | ✅ | |
| New sign-in from unrecognised device or location | 🟡 | Template exists, never called. Finding 1 |
| **Withdrawal address added or changed** | ❌ | The single most important security email you don't send. This is the primary account-takeover payoff |
| Email address changed | ❌ | Must go to **both** the old and new address, or a takeover is silent |
| New wallet linked (SIWE bind) | ❌ | |
| Auth method added or removed | ❌ | |
| Sessions revoked / signed out everywhere | ❌ | |
| Account banned or restricted | ❌ | Admin bans the wallet; the person is never told why or how to appeal |
| Withdrawal hold placed | ❌ | User currently discovers it by trying to withdraw |
| Repeated failed sign-ins / rate-limit trip | ❌ | |
| An admin granted themselves access to your receipt | ❌ | You audit-log `RECEIPT_INVITE`; the affected party never hears |

### 3.2 Onboarding

| Trigger | Status | Notes |
| --- | --- | --- |
| Welcome | ✅ | |
| Merchant access approved | ✅ | |
| **Merchant access declined** | ❌ | You have a distinct `MERCHANT_ACCESS_DECLINE` audit action, but the applicant gets silence. Worst experience in the product right now |
| Merchant access revoked | ❌ | |
| Merchant invite expiring or unused | ❌ | |
| Email verified confirmation | ❌ | |
| First wallet funding received | ❌ | |
| Never funded after N days | ❌ | Highest-leverage activation nudge you're missing |

### 3.3 Payments → payer

| Trigger | Status | Notes |
| --- | --- | --- |
| Payment receipt | 🟡 | Payment links only. Finding 2 |
| Payment failed / insufficient funds | ❌ | `payment.failed` event exists |
| Payment pending longer than expected | ❌ | `payment.pending` exists |
| Refund issued | ❌ | `payment.refunded` event exists; no refund system does |
| Duplicate charge detected | ❌ | You market "no double billing" — prove it in writing when it's prevented |

### 3.4 Payments → merchant

| Trigger | Status | Notes |
| --- | --- | --- |
| Payment received | 🟡 | Payment links only |
| Payout confirmed | ❌ | `payout.confirmed` exists |
| Payout failed | ❌ | `payout.failed` exists |
| **Webhook endpoint failing repeatedly** | ❌ | Merchants silently stop fulfilling orders. Critical for a payments API |
| API key created, revoked, or unused | ❌ | |
| Daily or weekly settlement digest | ❌ | |
| Monthly statement with the 1% fee itemised | ❌ | Merchants will ask for this at tax time |

### 3.5 Subscriptions → customer

Every row here has a matching event in `types.ts`, and several are legally expected in the EU, UK, and California.

| Trigger | Status | Notes |
| --- | --- | --- |
| Subscription started | ❌ | DM covers it |
| **Renewal upcoming** | ❌ | DM covers it. Advance renewal notice is a legal requirement in several jurisdictions, and in-app doesn't satisfy it |
| Renewed / charged this cycle | ❌ | |
| **Cancellation confirmed** | ❌ | The email users screenshot as proof. Your whole anti-dark-pattern pitch rests on this one |
| Cancel scheduled for period end | ❌ | |
| Payment failed → retry schedule (day 1 / 3 / 7) | ❌ | Finding 9 |
| Allowance low, top up to stay active | ❌ | DM covers it |
| Trial ending | ❌ | DM covers it |
| Trial converted to paid | ❌ | |
| **Price change advance notice** | ❌ | Legally required in multiple jurisdictions |
| Plan changed / upgraded | ❌ | |
| Access ended / subscription expired | ❌ | |
| Sponsored access ending | ❌ | DM covers it |

### 3.6 Subscriptions → merchant

| Trigger | Status | Notes |
| --- | --- | --- |
| Subscriber cancelled, with reason | ✅ | Nicely done |
| New subscriber | ❌ | |
| Dunning outcome (recovered or lost) | ❌ | |
| Churn and MRR digest | ❌ | |

### 3.7 Vault / pay-per-use

All six have events defined; none email.

| Trigger | Status |
| --- | --- |
| Commit activated for the cycle | ❌ |
| Usage threshold reached | ❌ |
| Vault settled at cycle end | ❌ |
| Vault inactive → service being refused | ❌ |
| Auto top-up succeeded or failed | ❌ |
| Dispute opened or resolved | ❌ |

### 3.8 Payroll

Six events defined, no email. `payroll.authorization_required` in particular blocks money moving until someone acts — and nothing tells them to.

| Trigger | Status |
| --- | --- |
| Authorization required | ❌ |
| Execution started / succeeded / failed | ❌ |
| Payroll paused | ❌ |

### 3.9 Support

| Trigger | Status | Notes |
| --- | --- | --- |
| New ticket → admin alert | ✅ | |
| **Ticket received → confirmation to the requester** | ❌ | Someone reports a payment problem and gets no acknowledgement at all |
| Admin replied | ❌ | |
| Ticket resolved | ❌ | |

### 3.10 Internal / operational → admins

| Trigger | Status | Notes |
| --- | --- | --- |
| Platform flag toggled | ✅ | |
| New support ticket | ✅ | |
| **Sponsor wallet underfunded** | ❌ | `getSponsorWalletStatus` already computes `underfunded` and `estimatedTopupsRemaining`. Nothing alerts on it. When it empties, every sponsored payment fails closed — correct behaviour, silent outage |
| Sponsor emergency stop engaged | ❌ | |
| **Admin granted or revoked** | ❌ | You email all admins when a flag flips, but not when someone *becomes an admin*. That's the more serious event |
| Ban or withdrawal hold placed by another admin | ❌ | |
| KYC queue aging past SLA | ❌ | |
| Merchant access request waiting | ❌ | |
| Reconciliation backlog growing | ❌ | |
| Velocity / unusual volume alert | ❌ | |

### 3.11 Compliance and legal

| Trigger | Status |
| --- | --- |
| Terms or privacy policy changed | ❌ |
| Data export ready | ❌ |
| Account deletion confirmed | ❌ |
| KYC document expiring | ❌ |

---

## Part 4 — Suggested order

**Tier 0 — before anything else.** Fix the four things that are broken rather than absent, plus the two silences that cost you users:

1. Wire up `sendSignInAlertEmail` — it's written, it just needs calling
2. Move `sendPaymentReceiptEmails` out of the payment-link worker and onto every settlement path
3. Split the per-recipient rate limit by category so receipts can never starve a verification code, and stop dropping over-limit sends silently
4. Merchant access **declined** email
5. Cancellation confirmation email
6. Support ticket confirmation to the requester
7. Sponsor-wallet-underfunded ops alert

**Tier 1 — the infrastructure that has to exist before volume.**

8. Email outbox with durable retry, modelled on `webhookOutbox`
9. Resend bounce and complaint webhook plus a suppression list
10. Four preference categories, with security non-optional
11. `List-Unsubscribe` header and a footer preference link
12. Withdrawal-address-change and email-change alerts (both addresses)

**Tier 2 — the revenue and retention ones.**

13. Dunning sequence, matching the day 1 / 3 / 7 schedule in the brief
14. Renewal upcoming and price change notices — these are compliance, not marketing
15. Merchant webhook-failing alert
16. Payout confirmed and failed
17. Admin granted or revoked

**Tier 3 — everything else.** Vault lifecycle, payroll, digests, statements, trials, activation nudges.

---

## Part 5 — One design note

Nearly every Tier 2 and 3 row already has an event in `src/lib/events/types.ts` and, for many, a DM type too. So the right move probably isn't eight more exported functions in `transactional.ts`.

You've already built the hook: `recordMerchantEvent` writes a canonical durable event ledger with an outbox, and `dispatchDurableSubscriptionWebhook` shows the pattern — durable ledger write first, best-effort send after, cron drains as fallback. Email should be a second consumer of that same ledger: check the recipient's category preference, render from a template registry keyed by event name, send. That turns "add an email" into a template plus a mapping row, and it makes DM, webhook, and email three renderers over one event source instead of three parallel paths that drift.

It also solves finding 4 for free — the outbox already exists, email just isn't using it.

Worth reading `src/lib/subscriptions/webhookDelivery.ts` before designing this. Its header documents a real incident where subscription events reached merchants only when the cron drained, with measured latency of 3 to 55 minutes, because payments flushed inline at settlement and subscriptions didn't. Email will hit the same trap in the same place if it inherits the cron-only path.

`transactional.ts` is already 448 lines with the layout, the escaping, the formatting, and all eight templates in one file. It'll need splitting regardless.
