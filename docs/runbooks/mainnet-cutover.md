# SubScript — Mainnet Cutover Runbook

The single source of truth for taking SubScript from Arc **testnet** to **mainnet** and going live.

**Network selection is configuration** — the code is network-agnostic, defaults are testnet, and
nothing changes until you set the values in §1. **Identity is not.** Every user's embedded wallet
has to be re-provisioned at a new address, and the root admin wallet can lock you out of the console
if it is custodial. That work is in §1.5 and it is the part people underestimate.

Read §0 first: as of current verification, there are external triggers (Arc mainnet parameter publication and Circle mainnet blockchain registration) that must clear before broadcast.

> Convention used here: ✅ = done in code · ⚙️ = config you set · 🧪 = verify / test · ⚖️ = business/legal · 🛑 = hard blocker

---

## 0. Pre-flight & External Triggers Readiness (Do These First)

> ### 🛑 External Publication & Provider Triggers
>
> 1. **Arc Mainnet Parameter Publication:** Arc's canonical mainnet chain ID, RPC endpoints (`https://rpc.mainnet.arc.io`), block explorer (`https://arcscan.app`), native USDC token address, Arc L1 Memo contract, and CCTP domain ID must be officially published by Arc.
> 2. **Circle Mainnet Blockchain Support:** Circle must include Arc in its production supported blockchains list with an official identifier (e.g., `ARC`). `CIRCLE_ARC_BLOCKCHAIN=ARC` is enforced by `assertFinancialNetworkReady()` in mainnet mode.
> 3. **StableFX / FX Router Address:** `SubScriptPSA.stableFXRouter` is `immutable`. Ensure the final Arc mainnet StableFX or Permit2 escrow router address is locked before deploying PSA bytecode.

### Pre-Flight Readiness Checklist

- [ ] 🛑 **Arc Mainnet Availability:** Track `status.arc.io` and official Arc announcements. Arc mainnet chain ID, RPC endpoints, and canonical USDC contract addresses must be officially published.
- [ ] 🛑 **Smart Contract External Security Audit:** Production contracts (`SubScriptRouter`, `SubScriptPSA`, `SubScriptVault`, `SubScriptConfidential`) must complete an independent external security audit, with all findings remediated and re-reviewed.
- [ ] 🛑 **Multi-Sig Safe Ownership:** Router, PSA, and Vault owner on mainnet must be a Gnosis Safe multi-sig (not a raw EOA). Signers, threshold (e.g., 3-of-5 or 2-of-3 with hardware wallets), and emergency pause/unpause/UUPS upgrade procedures must be rehearsed on testnet using `scripts/transfer-contract-ownership.mjs` and `docs/SECOPS.md`.
- [ ] 🛑 **Circle Production Account & Entity Secret:** Generate production `CIRCLE_API_KEY` (`LIVE_API_KEY:...`), 32-byte `CIRCLE_ENTITY_SECRET`, and registered recovery ciphertext. **Sandbox wallets cannot be migrated to mainnet** — every user gets a fresh mainnet address. See §1.5.
- [ ] 🛑 **Admin & Keeper Wallets Gas Funding:** Generate fresh, uncommitted private keys for Admin Keeper (`PRIVATE_KEY`), Vault Drawer (`KEEPER_PRIVATE_KEY`), and Gas Sponsor (`SPONSOR_PRIVATE_KEY`). Fund each with sufficient native USDC gas float on Arc mainnet.
- [ ] 🛑 **Root Admin Hardware Custody:** Verify all addresses in `ADMIN_WALLET_ADDRESSES` are self-custodied hardware wallets (Ledger/Trezor). Custodial Circle sandbox wallets as root will lock you out of the admin console on mainnet.
- [ ] ⚙️ **Enable Live API Keys:** Run the cutover migration to allow `mode = 'LIVE'` on `api_keys` and open `sk_live_` authentication.
- [ ] ⚙️ **Production Database & Secrets Provisioned:** Production Supabase instance, connection pooler (`DATABASE_URL` / `DIRECT_URL`), Upstash Redis cluster, Resend email keys, Sentry DSN, PostHog keys, and VAPID Web Push keys configured.

> **Why there is NO runtime "go mainnet" switch:** `isProd` derives from `NEXT_PUBLIC_ENVIRONMENT` (`src/lib/contracts/constants.ts:12`) and every contract address is an `export const` resolved at module load. Next.js inlines `NEXT_PUBLIC_*` at build time into client bundles. Cutover is an immutable **deploy**, which makes it clean, auditable, and fully reversible (§6).

---

## 1. Environment Variables Matrix (Vercel Production Scope)

### 1.1 Network Selection & RPC Configuration
| Variable | Production Value | Description |
|---|---|---|
| `NEXT_PUBLIC_ENVIRONMENT` | `mainnet` | Flips `isProd` to true, activating Arc Mainnet (`5042001`) across wagmi, CCTP, and API routes. |
| `RPC_URL` | `https://rpc.mainnet.arc.io` | Server-side primary RPC endpoint for ethers.js in API and cron routes. |
| `NEXT_PUBLIC_ARC_RPC_PRIMARY` | `https://rpc.mainnet.arc.io` | Client-side primary RPC endpoint for viem/wagmi in browser. |
| `ARC_RPC_FALLBACK` | secondary RPC URL | Optional secondary fallback RPC for backend reliability. |

### 1.2 Mainnet Contract Addresses (Fail-Closed Gate)
> **Mainnet is fail-closed:** When `NEXT_PUBLIC_ENVIRONMENT=mainnet`, all financial routes execute `assertFinancialNetworkReady()` (`src/lib/network/registry.ts`) and **refuse to serve (500)** unless every single one of these variables is populated with a valid `0x[a-fA-F0-9]{40}` address:

| Variable | Target Contract / Resource | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS` | `SubScriptRouter` (UUPS Proxy) | Deployed on Arc mainnet |
| `NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS` | `SubScriptPSA` (Immutable) | Deployed on Arc mainnet |
| `NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS` | `SubScriptConfidential` (Immutable) | Deployed on Arc mainnet |
| `NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS` | `SubScriptVault` (UUPS Proxy) | Deployed on Arc mainnet |
| `NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID` | `5042001` | Must equal Arc Mainnet Chain ID |
| `NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS` | Premium Treasury Recipient | Cold storage / Multi-Sig Safe |
| `NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS` | Arc L1 Memo Predeploy | Receipt memo binding contract |
| `NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS` | Arc CCTP Message Transmitter V2 | Cross-chain message transmitter |
| `NEXT_PUBLIC_USDC_ADDRESS` | Native USDC Predeploy | `0x3600000000000000000000000000000000000000` |
| `TREASURY_ADDRESS` | Protocol Fee Treasury | Cold Multi-Sig receiving 1% merchant fees |
| `CIRCLE_ARC_BLOCKCHAIN` | `ARC` | Official Circle mainnet blockchain identifier |
| `STABLEFX_ROUTER_ADDRESS` | Arc FX Router / Permit2 | Locked in PSA constructor |
| `MULTISIG_ADDRESS` | Gnosis Safe Multi-Sig | Contract owner address |

### 1.3 Server Secrets & Operational Keys
| Variable | Description / Purpose |
|---|---|
| `DATABASE_URL` | Supabase Transaction Pooler URL (pgBouncer port 6543) |
| `DIRECT_URL` | Supabase Direct Connection URL (port 5432, for migrations) |
| `SUPABASE_URL` | Supabase project API gateway |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for backend elevated database access |
| `CIRCLE_API_KEY` | Circle Developer-Controlled Wallets Live API Key (`LIVE_API_KEY:...`) |
| `CIRCLE_ENTITY_SECRET` | 32-byte hex entity secret registered in production |
| `CIRCLE_WALLET_SET_ID` | Production wallet set ID for user embedded wallets |
| `CRON_SECRET` | Secret for Vercel Cron authentication (`Authorization: Bearer <CRON_SECRET>`) |
| `KEEPER_SECRET` | Secret for external keeper scheduler authentication |
| `SUBSCRIPT_WEBHOOK_SECRET` | HMAC secret for signing and verifying inbound/outbound webhooks |
| `PRIVATE_KEY` | Admin keeper EOA private key (signs renewal transactions, pays gas) |
| `KEEPER_PRIVATE_KEY` | Vault drawer EOA private key (authorized in `SubScriptVault`) |
| `SPONSOR_PRIVATE_KEY` | Gas sponsor EOA private key (credits gas for sponsored actions) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for distributed rate limiting & edge flags |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token |
| `RESEND_API_KEY` | Transactional email provider API key |
| `SENTRY_DSN` | Sentry production project DSN |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog production analytics key |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingestion host URL |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_SUBJECT` | Web Push contact mailto URI |
| `ADMIN_WALLET_ADDRESSES` | Comma-separated list of root admin hardware wallet addresses |

---

## 1.5 Identity Migration & Data Segregation Architecture

### 1.5.1 Circle Sandbox vs Production Wallet Isolation
Circle's developer-controlled MPC wallets are strictly isolated between sandbox and production:
- Sandbox wallets exist under `TEST_API_KEY` and the sandbox entity secret. Key shares cannot be exported, migrated, or addressed by a production API key.
- On mainnet, when users authenticate via Google OAuth or SIWE, the platform provisions **fresh Circle MPC wallets at new addresses**.
- Testnet USDC is valueless, so no economic value is stranded.

### 1.5.2 Mandatory Separate Production Database
Mainnet **MUST** run on a completely dedicated Supabase PostgreSQL database instance:
- **Zero Cross-Contamination:** Prevents testnet mock data from mingling with real monetary settlements.
- **Permanent Sandbox:** Keeps the testnet environment alive indefinitely for merchant testing and third-party integrations (mirroring Stripe's architecture).
- **Clean Audit Trail:** Guarantees all rows in the production database represent real, audited financial transactions.

### 1.5.3 Account Deletion (GDPR) vs Regulated KYC Retention
- **GDPR Obligation:** When a user requests account deletion, `closure_status` transitions to `PENDING_DELETION`. The scheduled `/api/cron/gdpr-hard-delete` sweeper permanently purges account personal data after the 30-day statutory window.
- **AML/KYC Obligation:** Financial regulations require retaining identification records and transaction ledger hashes for statutory audit periods (5–7 years). Anonymization strips personal identifiers while preserving immutable cryptographic hashes in `admin_audit_log` and `ledger_entries`.

### 1.5.4 Root Admin Lockout Prevention
- `ADMIN_WALLET_ADDRESSES` is an environment variable configuration that sits outside database console reach by design.
- **Root Admin Hardware Wallet Requirement:** Root admin addresses must be self-custodied hardware wallets (Ledger/Trezor). An address held on an external key signs on any EVM network identically. If root is a Circle sandbox custodial wallet, mainnet deployment permanently locks staff out of the console.
- **Audit Delegated Admin Scopes:** Verify all delegated admins in `admin_wallets` have explicit least-privilege scopes (`finance`, `support`, `compliance`, `risk`, `engineering`, `governance`) before cutover.

---

## 1.6 Database Schema Cutover Migration

Before launching production traffic, execute the dedicated cutover migration:

```bash
# Execute against the Production Supabase Database
psql "$DIRECT_URL" -f docs/runbooks/mainnet-sql-cutover.sql
```

### Critical Database Changes Applied by `docs/runbooks/mainnet-sql-cutover.sql`:
1. **Drop Hardcoded Testnet Defaults:** Drops `DEFAULT 5042002` from `payment_sessions.chain_id` and `payment_links.settlement_chain_id` so missing insert fields fail loudly instead of stamping testnet on mainnet rows.
2. **Update Metered Vaults Check Constraint:** Replaces `metered_vaults_environment_chain_check` to permit both `('TEST', 5042002)` and `('LIVE', 5042001)`.
3. **Drop PSA Address Default:** Drops hardcoded testnet PSA address default on `subscriptions.contract_address`.
4. **Composite Billing Claims Key:** Updates `subscription_billing_claims` unique constraint to `(contract_address, subscription_id)` to eliminate cross-contract generation key contention.
5. **Enable Live API Keys:** Updates `api_keys_mode_check` to permit `mode = 'LIVE'`.
6. **Enforce Row Level Security (RLS):** Confirms deny-all public RLS policies across all sensitive tables.

---

## 2. Master Background Keeper & Cron Matrix

| Endpoint | Schedule / Trigger | Host / Scheduler | Auth Header | Purpose |
|---|---|---|---|---|
| `/api/cron/customer-billing` | `0 3 * * *` (daily) | Vercel Cron (`vercel.json`) | `Bearer ${CRON_SECRET}` | Renews due customer subscriptions; executes scheduled period-end cancellations. |
| `/api/keeper/vault-draw` | `0 4 * * *` (daily) | Vercel Cron (`vercel.json`) | `Bearer ${CRON_SECRET}` | Settles matured metered-vault usage on-chain; refunds unused escrow. |
| `/api/keeper/cctp` | `*/5 * * * *` (every 5 min) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Relays CCTP cross-chain mints upon Circle attestation availability. |
| `/api/cron/reconcile` | `*/15 * * * *` (every 15 min) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Recovers stuck checkout attempts and payment reconciliation events. |
| `/api/keeper/vault-topup` | `*/15 * * * *` (every 15 min) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Executes user-authorized automatic vault top-ups. |
| `/api/internal/sponsor-health`| `*/15 * * * *` (every 15 min) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Monitors gas sponsor wallet balance and emails admins before depletion. |
| `/api/cron/billing` | `0 2 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Premium merchant subscription billing & grace-period downgrades. |
| `/api/internal/payroll` | `0 5 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Executes scheduled merchant payroll campaign payouts. |
| `/api/internal/billing` | `0 6 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Delinquent merchant tier downgrade sweep (`GET` method). |
| `/api/cron/kyc-expiry` | `0 7 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Expaires stale/lapsed KYC verification records. |
| `/api/cron/gdpr-hard-delete` | `0 8 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Permanently purges accounts pending deletion > 30 days. |
| `/api/cron/payment-reminders` | `40 8 * * *` (daily) | External / GitHub Actions | `Bearer ${KEEPER_SECRET}` | Dispatches upcoming renewal and trial-ending email notifications. |

---

## 3. Phased Mainnet Cutover Timeline & Step-by-Step Sequence

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             MAINNET CUTOVER TIMELINE                             │
├─────────────────┬──────────────────┬─────────────────┬─────────────┬─────────────┤
│   T-72 Hours    │    T-24 Hours    │    T-2 Hours    │     T-0     │    T+1h     │
│ Pre-Cutover Ops │ Freeze & Secrets │ Environment Set │ Deploy & TX │ Smoke & Go  │
└─────────────────┴──────────────────┴─────────────────┴─────────────┴─────────────┘
```

### Phase 1: T-72 Hours (Pre-Cutover Preparation)
1. 🛑 Complete and sign off all 12 domains in `docs/runbooks/mainnet-audit-master-checklist.md`.
2. 🛑 Deploy and verify Gnosis Safe multi-sig on Arc Mainnet with hardware wallet signers.
3. 🛑 Generate and record production Circle Entity Secret and Live API Key.
4. 🛑 Generate fresh, uncommitted keypairs for Admin Keeper, Vault Drawer, and Gas Sponsor.

### Phase 2: T-24 Hours (Code Freeze & Database Provisioning)
1. 🛑 Cut the production Git release tag (`git tag v1.0.0-mainnet`).
2. 🛑 Provision fresh Production Supabase database instance and Upstash Redis cluster.
3. 🛑 Run `docs/runbooks/mainnet-sql-cutover.sql` on production database.
4. 🛑 Fund Admin Keeper (`PRIVATE_KEY`), Vault Drawer (`KEEPER_PRIVATE_KEY`), and Sponsor (`SPONSOR_PRIVATE_KEY`) with Arc mainnet gas float.

### Phase 3: T-2 Hours (Smart Contract Mainnet Deployment)
1. 🛑 Deploy SubScript smart contracts in strict dependency order:
   - **Step 1:** StableFX Router / Permit2 Escrow (`STABLEFX_ROUTER_ADDRESS`).
   - **Step 2:** `SubScriptRouter` Implementation + UUPS Proxy (`scripts/deploy-router.js`).
   - **Step 3:** `SubScriptPSA` Constructor Deployment (`scripts/deploy-standard.js`).
   - **Step 4:** `SubScriptVault` Implementation + UUPS Proxy (`scripts/deploy-vault.js`).
   - **Step 5:** `SubScriptConfidential` Constructor Deployment (`scripts/deploy-confidential.js`).
2. 🛑 Transfer ownership of all three contracts (`Router`, `PSA`, `Vault`) to the Gnosis Safe Multi-Sig using `scripts/transfer-contract-ownership.mjs`.
3. 🛑 Authorize the Vault Drawer keeper on `SubScriptVault`: `setAuthorizedDrawer(KEEPER_ADDRESS, true)`.
4. 🛑 Verify all deployed contracts and implementations on Arcscan (`npm run check:contracts`).

### Phase 4: T-0 (Vercel Production Deployment)
1. ⚙️ Set all environment variables from §1 in Vercel (Production Scope).
2. ⚙️ Trigger production deployment in Vercel from release tag `v1.0.0-mainnet`.
3. 🧪 Verify Vercel Cron jobs are registered (`/api/cron/customer-billing`, `/api/keeper/vault-draw`).
4. 🧪 Configure GitHub Actions repo secrets (`KEEPER_SECRET`, `KEEPER_BASE_URL`) and trigger manual test run (`workflow_dispatch`).

### Phase 5: T+1 Hour (Smoke Testing & Go/No-Go Decision)
1. 🧪 Execute the live money smoke test trail (§4).
2. 🧪 Perform operational breaker verification drills (§5).
3. 📜 Release Commander confirms Go/No-Go decision and opens public traffic.

---

## 4. Smoke Test: Live Money Path Verification

Run the automated integration smoke test against the live production deployment:

```bash
SUBSCRIPT_BASE_URL=https://www.subscriptonarc.com \
SUBSCRIPT_SECRET_KEY=sk_live_... \
SUBSCRIPT_WEBHOOK_SECRET=whsec_... \
CRON_SECRET=... \
npm run integration:smoke
```

### End-to-End Real USDC Financial Verification Trail:
1. **Hosted Checkout ($1 USDC):** Create a 1.00 USDC payment link -> complete hosted checkout with a real funded wallet -> verify on-chain settlement, receipt token generation, and Arc L1 memo binding on Arcscan.
2. **Webhook Receipt:** Verify merchant endpoint receives HMAC-signed `payment.succeeded` webhook with valid `t=...,v1=...` headers.
3. **Recurring Subscription ($1 USDC/cycle):** Subscribe to a test plan -> verify PSA on-chain authorization -> trigger keeper renewal -> confirm `isSequenceExecuted` bitmap flip -> cancel subscription -> confirm immediate on-chain revocation.
4. **Metered Vault Escrow (2 USDC):** Commit 2.00 USDC to metered vault -> report usage -> settle via vault keeper draw -> confirm merchant pull-payment ledger credited less 1% fee -> confirm remaining surplus refunded to user.
5. **Merchant Claim:** Merchant withdraws settlement -> confirm funds transfer to payout destination and 1% fee transferred to `TREASURY_ADDRESS`.

---

## 5. Post-Cutover Operational Verification & Breaker Drills

- [ ] 🧪 **Exercise Operational Breakers in Admin Console (`/admin`):**
  - Toggle `withdrawals_enabled = false` in System Settings -> confirm withdrawal returns 503 via `assertWithdrawalAllowed()` -> toggle back to true.
  - Toggle `sponsor_emergency_stop = true` -> confirm sponsored gas falls back safely -> toggle back to false.
  - Toggle `maintenance_enabled = true` -> verify edge maintenance banner -> toggle back to false.
- [ ] 🧪 **Multi-Sig Safe Signer Drill:** Verify all Safe signers can load Safe UI, view contract states, and simulate transactions.
- [ ] 🧪 **Root Admin SIWE Sign-In:** Root admin signs in with hardware wallet session; confirm access to `/admin` and view scoped permissions.
- [ ] 🧪 **Delegated Admin Scopes Verification:** Delegated admins sign in; confirm role-scoped navigation and access boundaries.
- [ ] 🧪 **Sentry & Telemetry Check:** Verify clean Sentry dashboard with zero unexpected initialization exceptions.

---

## 6. Rollback & Disaster Recovery Protocol

In the event of a critical issue during cutover:

1. **Revert Environment:** In Vercel Environment Variables, set `NEXT_PUBLIC_ENVIRONMENT=testnet`, restore testnet contract addresses, and redeploy previous stable commit.
2. **Emergency Protocol Pause:** If funds are at risk on mainnet contracts, Multi-Sig Safe executes `pause()` calldata (`0x84b0196e`) on `SubScriptRouter` and `SubScriptVault`.
3. **Data Integrity:** Because mainnet was deployed on a separate production database, testnet sandbox data remains completely unaffected and intact.
4. **Incident Review:** Convene War Room, execute incident response playbooks in `docs/SECOPS.md`, and publish post-mortem within 72 hours.

---

## 7. Key Operational References

| Domain | File Path |
|---|---|
| Unified Mainnet Master Guide & Audit Bible | [`docs/mainnet/README.md`](../mainnet/README.md) |
| SQL Cutover Script | [`docs/mainnet/mainnet-sql-cutover.sql`](../mainnet/mainnet-sql-cutover.sql) |
| Security Operations & Emergency Calldata | [`docs/SECOPS.md`](../SECOPS.md) |
| Network Registry & Fail-Closed Gate | [`src/lib/network/registry.ts`](../../src/lib/network/registry.ts) |
| Contract Constants & Addresses | [`src/lib/contracts/constants.ts`](../../src/lib/contracts/constants.ts) |
| Wagmi & RPC Configuration | [`src/lib/wagmi.ts`](../../src/lib/wagmi.ts) |
| External Keepers Scheduler | [`.github/workflows/keepers.yml`](../../.github/workflows/keepers.yml) |
| Smoke Test Script | [`scripts/subscript-integration-smoke.mjs`](../../scripts/subscript-integration-smoke.mjs) |
| Contract Health Verification | [`scripts/check-contracts.mjs`](../../scripts/check-contracts.mjs) |
| Secret Scanning Gate | [`scripts/check-secrets.mjs`](../../scripts/check-secrets.mjs) |
