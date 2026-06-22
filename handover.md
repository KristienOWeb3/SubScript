# SubScript — Handover

## ⚠️ Workflow rule (read first)
**Push all work directly to `main`.** Kristien views progress on `main` (it's what Vercel deploys to
the live site), not on feature branches. Do not park fixes on `claude/*` branches expecting a merge —
commit and push to `main` so changes are visible/deployed. Verify with `npx tsc --noEmit` + `npm run build`
before pushing.

## Live state (end of this session)
- **The launch landing page is LIVE on `main`** (commit `252eb9b`). `subscriptonarc.com` now serves the
  product landing (hero CTAs *Get Started* / *Read the Docs*, stats bar, feature grid, how-it-works,
  consumer/business, final CTA) instead of the waitlist. `dashboard.subscriptonarc.com` remains the app.
- Earlier `main` had diverged and never received the prior build-cycle work, which is why the landing
  hadn't appeared until now.

## NOT yet on `main` (still only on branch `claude/launch-integration`)
This earlier work is built + verified but was never merged. To make it live, bring it onto `main`
(reconcile the small `packages/cli` conflict: main has its own CLI version/banner vs the branch's
`ethers` fix):
- Security: API-key hashing (+ Phase B runbook), step-up key export, internal-billing auth, durable batch payout.
- Dev: standalone CLI + subcommands, docs CLI quickstart + API reference.
- Features: pay-with-logged-in-account (no wallet reconnect), Web Push (VAPID, mobile-ready), QR scan-to-pay,
  in-DM request pop-out (amount/purpose/expiry, shimmer loading), fiat on-ramp (geo + CCTP guidance),
  Safe merchant multisig, auto-signup on payment.
- Privacy: confidential-by-default Phase 0 (free baseline, fails closed).
- Mainnet readiness: config-only chain/address switch + live API keys + `docs/go-live-checklist.md`.
- DM UX: centered layout, widened chat bubbles, bottom-bar hidden in a thread, peer requests non-shareable.
- **Launch mailer:** `scripts/send-launch-emails.mjs` (segments waitlist by `user_type`, two on-brand
  emails, dry-run by default; `--test <email>` to preview, `--send` to deliver via Resend).

## Pending launch actions
1. Confirm the landing deploy on `subscriptonarc.com` (hard-refresh if cached).
2. Decide whether to land the rest of `claude/launch-integration` onto `main` (recommended; it carries
   the security, multisig, fiat on-ramp, DM fixes, and the mailer).
3. Apply migration `supabase/migrations/20260625000000_confidential_by_default.sql` and run API-key
   **Phase B** after verifying; confirm Supabase PITR.
4. Set prod env (`.env.example`): `NODE_ENV=production`, secrets, Upstash, Sentry DSN, VAPID — redeploy.
5. Send launch emails (`--test` → dry-run → `--send`) once links point at the live landing.
6. Mainnet flip stays config-only when contracts are deployed + audited.

## How a merchant validates payments (reference)
Create Checkout Intent (`POST /api/intent`, Bearer secret) → store `intentId` by your order → customer
pays on hosted checkout → SubScript verifies on-chain → your backend gets a **signed webhook**
(`payment.success`); verify the `x-subscript-signature` HMAC over `` `${t}.${rawBody}` ``, dedupe on
`event.id`, fulfill by `data.intent_id`. Pull alternative: `GET /api/v1/subscriptions` with the secret key.

## Docs
`Flawless.md` (product docs), `CHANGELOG.md` (build log), `docs/go-live-checklist.md`,
`docs/confidential-by-default.md`, `docs/runbooks/null_api_key_plaintext_after_hash_rollout.sql`.

---

# Product Source of Truth (existing guidance — keep)

The current product source of truth is `C:\Users\Kristien\Downloads\Flawless.md`, mirrored into `docs/subscript-protocol-features-and-problems-solved.md`.

## Current Direction

SubScript is a programmable stablecoin commerce layer on Arc. It uses a Unified Payment Authorization (UPA) framework for one-time payments, recurring billing, usage-based charging, invoice-like collection, sponsored payments, and AI-native transactions.

## Live Platform Primitives

- Checkout Intents.
- Hosted Arc USDC payment links.
- Receipt tokens and Arc memo receipts.
- Signed merchant webhooks.
- Google wallet onboarding.
- Metered vault usage billing.
- DNS-style aliases.
- Premium/privacy, payroll, retry, reconciliation, and keeper-compatible surfaces.

## Deployment-Scoped Targets

These must stay caveated until implemented and verified in production:

- Encrypted private-key export after Google wallet provisioning.
- Direct fiat-to-USDC onramps.
- Dedicated invoice objects with custom due terms.
- Sponsor relationships for Pay for Me.
- Merchant commitment windows, minimum terms, and grace periods.
- Configurable smart dunning schedules.
- Chainlink Automation as the production execution layer.
- Circle Paymaster/Gas Station sponsorship.
- ArcaneVM production confidentiality.
- Arc quantum-resilience inheritance.

## Messaging Rules

- Do not describe SubScript as only a subscription platform; it is broader programmable USDC commerce.
- Do not use old ZK-gating language for the current product narrative. Use Privacy Premium, ArcaneVM, Arc Privacy Sector, governed visibility, and confidential execution.
- Keep CCTP disabled in hosted checkout messaging until Arc-side memo settlement is verifiable in one bound flow.
- Keep the merchant fee target as 1% and the Privacy Premium baseline target as 10 USDC/month unless pricing constants and product approval say otherwise.

## Verification Commands

```bash
npx tsc --noEmit --pretty false
npm run build
```
