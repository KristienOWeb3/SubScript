# SubScript Go-Live Checklist (Mainnet / Real Money)

The platform is engineering-ready and runs on Arc **testnet** by default. Going live with real USDC
is now a **configuration + operations** exercise, not a code rewrite — the chain, contract addresses,
and API-key mode are all environment-driven (see below). Work top to bottom; do not skip the
contract/audit and compliance items.

## 1. Smart contracts (blocking)
- [ ] Deploy `SubScriptRouter`, the standard subscription contract, and the confidential contract to **Arc mainnet**.
- [ ] Independent **security audit** of the deployed contracts before they custody real funds.
- [ ] Record the mainnet addresses for step 2.

## 2. Flip the network (configuration only)
Set these in the production environment (e.g. Vercel → Project → Environment Variables, Production):
- [ ] `NEXT_PUBLIC_ENVIRONMENT=mainnet`
- [ ] `NEXT_PUBLIC_ROUTER_ADDRESS`, `NEXT_PUBLIC_STANDARD_ADDRESS`, `NEXT_PUBLIC_CONFIDENTIAL_ADDRESS`,
      `NEXT_PUBLIC_PREMIUM_RECIPIENT_ADDRESS`, `NEXT_PUBLIC_MEMO_ADDRESS`,
      `NEXT_PUBLIC_MESSAGE_TRANSMITTER_ADDRESS`, `NEXT_PUBLIC_PLATFORM_MERCHANT_ADDRESS` — mainnet values.
      (Required on mainnet — there is no testnet fallback; a missing value fails loudly.)
- [ ] `ARC_RPC_PRIMARY` / `NEXT_PUBLIC_ARC_RPC_PRIMARY` (+ secondaries) → mainnet RPC endpoints.
- [ ] Redeploy and verify on a staging URL first: check the chain id, that a tiny real payment settles,
      and that receipts/webhooks fire.

## 3. Secrets & environment (blocking)
- [ ] All server secrets set (see `.env.example`): `JWT_SECRET`, `OTP_SECRET`, `WALLET_ENCRYPTION_KEY`,
      `PRIVATE_KEY`, `KEEPER_SECRET`, `SUBSCRIPT_WEBHOOK_SECRET`, `ADMIN_API_KEY`, Supabase keys, `DATABASE_URL`.
- [ ] `NODE_ENV=production` (disables offline-auth / sandbox-OTP dev fallbacks).
- [ ] `UPSTASH_REDIS_REST_URL`/`TOKEN` set so rate limiting uses Redis, not the in-memory fallback.
- [ ] `NEXT_PUBLIC_SENTRY_DSN` set so production errors are captured.
- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_*` set, then **redeploy** (the public key is inlined at build time).

## 4. Database (blocking)
- [ ] Apply pending migrations (`supabase db push`), including `push_subscriptions` and `confidential_by_default`.
- [ ] Run API-key Phase B once the hash-aware code is verified in production:
      `docs/runbooks/null_api_key_plaintext_after_hash_rollout.sql` (back up first).
- [ ] Confirm Supabase **Point-in-Time Recovery / backups** are enabled.

## 5. Merge outstanding PRs
- [ ] `claude/dashboard-polish` (camera Permissions-Policy fix, mobile app icons + manifest, QR mobile-only, DM request pop-out).
- [ ] `claude/fiat-onramp`, `claude/docs-redesign`, `claude/merchant-multisig`, `claude/confidential-phase0`.

## 6. Compliance & legal (longest lead — start early)
- [ ] KYC/AML program for high-value flows; money-transmission posture for active jurisdictions.
- [ ] Terms / privacy / refund policy reviewed for a real-money payments product.
- [ ] App Store / Play Store policy review if/when the mobile app ships (crypto wallet + payments rules).

## 7. Load & resilience
- [ ] Run `npm run load:test` against staging; confirm RPC fallback and keeper behavior under load.
- [ ] Verify circuit breakers (`system_settings`: `withdrawals_enabled`, `batch_payouts_enabled`,
      `hosted_payments_enabled`) and an incident runbook for flipping them off.

## 8. Final pre-flight
- [ ] Smoke test on production: signup → fund → pay a link → receipt → webhook → subscription renew.
- [ ] Confirm `npx @subscript-protocol/cli` scaffolds against the production API.
- [ ] Announce, then watch Sentry + payment reconciliation closely for the first cycles.
