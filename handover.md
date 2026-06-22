# SubScript — Session Handover

Last updated: June 2026. This captures the state at the end of the pre-launch build cycle so the next
session/person can pick up cleanly.

## Where the docs live
- **`Flawless.md`** — the product documentation (features + problems solved). Treat as the docs source.
- **`CHANGELOG.md`** — everything implemented/hardened this build cycle, grouped by area.
- **`docs/go-live-checklist.md`** — the ordered mainnet/launch runbook.
- **`docs/confidential-by-default.md`** — phased plan for on-chain merchant-transaction privacy.
- **`docs/runbooks/null_api_key_plaintext_after_hash_rollout.sql`** — API-key Phase B (destructive).

## The launch cut
Everything not already in `main` is consolidated on **one branch: `claude/launch-integration`**
(builds clean: `tsc` 0 errors + `next build`). Merge that single branch to `main` for launch.

It stacks: confidential-phase0, fiat-onramp, merchant-multisig, docs-redesign, dashboard-polish,
testnet-payment-flow, mainnet-readiness, landing-page, plus the CLI `1.3.1` fix.

Already in `main` (do not re-merge): the security hardening, the CLI split (`packages/cli`), and
push/QR/skeleton (`user-facing-features`). `merchant-privacy` is superseded by `confidential-phase0`.

## Pending launch actions (in order)
1. **Merge `claude/launch-integration` → `main`.** Then delete the other `claude/*` branches.
2. **Republish the CLI as `1.3.1`** (fixes the broken npx — `1.3.0` is missing the `ethers` dep):
   ```powershell
   git checkout main && git pull          # must have the 1.3.1 fix locally first
   npm publish --workspace @subscript-protocol/cli --access public
   npx --yes @subscript-protocol/cli@1.3.1 --version   # expect 1.3.1
   ```
   (The earlier publish failed because the local checkout was still on `1.3.0`.)
3. **Database:** apply `supabase/migrations/20260625000000_confidential_by_default.sql`; after the
   hash-aware code is verified in prod, run API-key **Phase B** (`docs/runbooks/...`). Confirm
   Supabase PITR/backups are on.
4. **Production env:** set all secrets (see `.env.example`), `NODE_ENV=production`, Upstash, Sentry
   DSN, VAPID keys — then redeploy (VAPID public key is build-time inlined).
5. **Mainnet flip (when ready):** deploy + audit contracts, then set `NEXT_PUBLIC_ENVIRONMENT=mainnet`
   and the `NEXT_PUBLIC_*` address vars. The code is config-driven and fails loud on missing mainnet
   addresses. Live API keys (`sk_live_`) then issue automatically.

## How a merchant validates payments (quick reference)
Create a Checkout Intent (`POST /api/intent`, Bearer secret) → store `intentId` beside your order →
customer pays on hosted checkout → SubScript verifies on-chain (event/amount/memo + confirmations) →
your backend receives a **signed webhook** (`payment.success`); verify the `x-subscript-signature`
HMAC over `` `${t}.${rawBody}` ``, enforce idempotency on `event.id`, fulfill by `data.intent_id`.
Pull-verify alternative: `GET /api/v1/subscriptions` with the secret key. Full detail in `/docs`.

## Open follow-ups / decisions (not blocking launch)
- **CLI weight:** `1.3.1` adds `ethers` (for dashboard-bridge signature verification). Option to slim
  the CLI by lazy-loading commands / replacing that check if a minimal install matters.
- **Confidential privacy Phases 1–3:** confidential routing for regular withdraw + inbound checkout
  is contract-level work (needs testnet + audit). Phase 0 (free baseline, fails closed) is shipped.
- **Polish deferred:** DM payment-link recipient binding (recommended: soft-bind, don't hard-block),
  mobile chat-section width, account-pay role-parity warning, batch-payout idempotency key.
- **Mobile app:** push backend + Circle SDKs are mobile-ready; see the cost/approach notes discussed.

## Verifying locally
`npm run build` (prisma generate + next build). If `tsc` shows stray errors in `vault/config` or
`.next/types`, run `npx prisma generate` and `rm -rf .next` first — those are stale-cache artifacts,
not real errors.
