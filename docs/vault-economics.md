# Vault Economics

SubScript vaults provide real USDC escrow for pay-after-service merchants — on Arc **testnet**
today (test USDC has no monetary value).

## Deployment status

An earlier vault revision is **deployed on Arc testnet behind a UUPS proxy**
(`NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS`). The source in `contracts/SubScriptVault.sol` is the
**V3 implementation candidate** carrying the platform-fixed 2 USDC policy below. The live proxy
has **not** been upgraded to it yet — see the upgrade gate at the bottom.

## The platform-fixed 2 USDC policy

- The standard commitment AND the maximum merchant-drawable exposure for every
  (user → merchant) relationship is **2 USDC per cycle** (`STANDARD_COMMIT = 2,000,000`
  micro-USDC). It is a contract constant.
- It is **not merchant-configurable**: `setRequiredCommit` was removed. A merchant cannot
  raise the cheque a user's escrow writes.
- A user may deposit more than 2 USDC, but **surplus never expands what the merchant can
  draw** — settlement is capped at `min(accepted usage, escrow, 2 USDC)` and every unit
  above the draw is refunded to the user in the same transaction.
- Service stays inactive below 2 USDC; reaching it activates a rolling 30-day cycle
  (test-only clocks may shorten cycles in test environments).

## Usage reporting is evidence, not authority

- The merchant reports billable units through `POST /api/user/vault/report-usage`
  (TEST API key required; the vault row must itself be TEST on Arc testnet). Reports are
  serialized per vault, idempotent by `x-request-id`, and accrue an append-only ledger.
- Merchants have **no direct draw authority on-chain** (`drawUsage` was removed). Only the
  authorized SubScript settlement keeper (`drawUsageFor`) finalizes a cycle, submitting the
  accepted off-chain ledger total.
- The contract bounds the keeper instead of trusting it: only after cycle maturity, only
  before the reclaim window opens, never above the escrow or the 2 USDC cap, and never
  while a dispute is open.

## Reconciliation

- At cycle maturity the keeper submits the recorded usage total on-chain.
- The vault pays at most `min(escrow, 2 USDC)` to the merchant ledger; every unused USDC
  returns to the customer in the same settlement transaction.
- The vault closes and goes inactive after settlement; a fresh 2 USDC commitment restarts service.
- Settlement cannot happen before maturity, and an active commitment cannot be withdrawn
  around reconciliation.
- The merchant pays the protocol's flat 1% fee when claiming settled funds.

## Disputes

- A user may `raiseDispute(merchant)` while the vault is active. An **open dispute blocks
  settlement AND reclaim** — the escrow freezes for both parties.
- Only the contract owner resolves a dispute (`resolveDispute`), optionally reopening a
  settle window if the original one lapsed during the dispute.

## Exhaustion

If reported usage would exceed the remaining commitment, the usage API returns
`402 COMMIT_EXHAUSTED`, records a direct customer notification, and sends browser push when
enabled. No debt or negative balance is created.

## Reclaim (liveness escape hatch)

If a matured cycle is never settled within `lockedUntil + 7 days`, the user may
`reclaimAbandonedEscrow` for the full balance — escrow can never be permanently locked, even
while the contract is paused. The keeper must therefore settle within the 7-day grace; the
vault-draw job runs daily, well inside the window.

## Trust boundary

The contract guarantees a merchant can never receive more than `min(escrow, 2 USDC)` per cycle
and can never settle before maturity or during a dispute. The keeper is the remaining trusted
component: it chooses the `amount` (the accepted usage ledger). That trust is bounded by the
caps above and audited by the append-only `metered_usage_reports` ledger; a signed
settlement-authorization or committed usage-root design can further shrink it in a future
revision.

## Real-only operation

Off-chain balance creation and simulated top-ups are disabled. Commit, settlement, refund, and
merchant claim all move real (test) USDC on-chain. The database is a read and gating mirror;
it is not a source of funds.

## Operational requirements

- `KEEPER_PRIVATE_KEY` must be an authorized vault drawer.
- `CRON_SECRET` or `KEEPER_SECRET` authenticates the daily vault-draw job.
- Existing vault proxies must be upgraded with `initializeV2(treasury)` in the same
  `upgradeToAndCall` transaction (already applied on the live testnet proxy).

## V3 upgrade gate (operator approval required)

Do **not** upgrade the deployed testnet proxy to the V3 implementation until ALL of:

1. Storage layout is verified append-only against the deployed implementation
   (`requiredCommit` slot is retained as `legacyRequiredCommit`; `disputeHold` is appended).
2. `forge test` (SubScriptVault.t.sol — 17 tests) and `npx hardhat test test/SubScriptVault.test.js`
   (12 tests) pass at the deployment commit.
3. Initialization review: `initialize` locked, `initializeV2` owner-gated, no new reinitializer needed.
4. Merchant direct draw is proven impossible and the 2 USDC cap is proven (both suites cover this).
5. Pause and reclaim behavior passes (both suites cover this).
6. Bytecode and proxy implementation are verified on Arc testnet after the upgrade
   (`npm run check:contracts`), and `src/lib/contracts/health.ts` selectors are updated to
   the V3 ABI in the same change.
