# Vault Economics (commit / draw / gated resume)

Status: **design — pending approval & contract deployment.** Funds logic, so we lock the
contract interface first, deploy, then wire the off-chain mirror, routes, and UI.

## The model (as specified)

- The **merchant sets the commit amount** required to use their metered service.
- A **user commits** (escrows) that amount. While the vault is **active**, the service is
  rendered for the cycle (~30 days).
- At cycle end the **merchant draws the period's usage cost** from the escrow:
  - usage ≤ escrow → surplus remains; the user may **withdraw it** or leave it in.
  - usage > escrow → escrow → 0 and the excess becomes **`owed`** (debt). SubScript
    **never** pulls from the user's main balance.
- A vault with `owed > 0` or `balance < requiredCommit` is **inactive** — the service is
  refused. To **resume**, the user deposits enough to clear `owed` **and** restore the
  commit. **SubScript gates this** (the usage API refuses calls for an inactive vault).
- If usage was under the commit, the user can **withdraw the surplus** to their wallet, but
  must top back up to the commit before using the service again.

Trust boundary: on-chain escrow guarantees the merchant is paid **up to the committed
balance**. The `owed` overage can't be force-collected — it's only recovered on re-commit.
So merchants should size the commit to cover expected monthly usage.

## On-chain contract — `contracts/SubScriptVault.sol` (draft)

UUPS-upgradeable, `Ownable`, `Pausable`, `ReentrancyGuard`, `SafeERC20` (matches
`SubScriptRouter`). One vault per `(user, merchant)`; merchant settlement uses a
pull-payment ledger (`merchantClaimable` + `merchantClaim()`), same pattern as the router.

Interface:
- `setRequiredCommit(uint256)` — merchant sets their service's commit.
- `commit(address merchant, uint256 amount)` — user escrows; clears `owed` first, then
  tops up; activates + starts a cycle when `balance >= requiredCommit && owed == 0`.
- `withdrawSurplus(address merchant, uint256 amount)` — user pulls unused escrow (only if
  `owed == 0`); dropping below the commit deactivates until re-commit.
- `drawUsage(address user, uint256 amount)` — merchant draws the cycle's cost.
- `drawUsageFor(address merchant, address user, uint256 amount)` — SubScript keeper draws
  at cycle end (gated by `authorizedDrawers`).
- `merchantClaim()` — merchant withdraws settled funds.
- views: `getVault`, `isActive`. admin: `setAuthorizedDrawer`, `setCycleLength`, pause.

## Off-chain mirror (Supabase / Prisma)

Extend `metered_vaults` (mirror of chain state for fast reads + gating). New columns:
- `commit_usdc` (BigInt) — required commit snapshot.
- `owed_usdc` (BigInt, default 0).
- `accrued_usage_usdc` (BigInt, default 0) — usage reported this cycle (drives the draw).
- `cycle_start` (timestamp).
- `active` (boolean, default false).
- `vault_chain_id`, `last_synced_block` — for event sync.

The mirror is updated by (a) an indexer/sync reading `Committed/UsageDrawn/SurplusWithdrawn`
events, and (b) `report-usage` incrementing `accrued_usage_usdc`.

## Route / API changes

- **`POST /api/user/vault/report-usage`** (merchant API key): instead of decrementing a
  prepaid balance, it **accrues** usage (`accrued_usage_usdc += amount`) and **gates**:
  returns `402` if the vault is inactive (`owed > 0` or `balance < commit`), with a clear
  "re-commit required" payload. No more simulated auto-top-up.
- **Cycle draw (keeper)**: a scheduled job finds vaults past `cycle_start + cycleLength`,
  calls `drawUsageFor(merchant, user, accrued_usage_usdc)` on-chain, then resets
  `accrued_usage_usdc` and re-syncs `balance/owed/active` from the event.
- **Merchant config**: endpoint for the merchant to set `requiredCommit` (writes on-chain +
  mirror).
- **User actions**: commit / withdraw surplus are on-chain txs from the user's wallet
  (embedded → server-signed via the existing pattern; external → wallet signature), then
  mirror re-sync.

## UI changes

- **User vault card**: show committed balance, required commit, owed (if any), cycle end,
  and active/blocked state. Actions: **Commit / Re-commit** (clears owed + restores commit)
  and **Withdraw surplus**. The existing "What is a vault?" modal already explains the model.
- **Merchant**: set the required commit; see per-user vault status; claim settled funds.

## Rollout sequence (because it handles funds)

1. **Approve the contract interface** above.
2. Add Foundry tests; deploy `SubScriptVault` to Arc testnet behind a UUPS proxy.
3. Provide the deployed address + set an authorized keeper drawer.
4. Migration for the new `metered_vaults` columns.
5. Implement routes (gating + accrual + draw job + commit/withdraw) against the address.
6. Wire the UI; verify the full commit → use → draw → negative → re-commit loop on testnet.
7. Audit before mainnet.

## Confirmed decisions

- **Draw trigger**: SubScript **keeper** calls `drawUsageFor()` at cycle end (hands-off).
- **Cycle anchor**: **rolling 30 days** from the last commit/draw, per vault.
- **Commit scope**: **per `(user, merchant)`** — one commit covers all of that merchant's
  metered usage.
- **Embedded-wallet commits**: **server-signed** from the user's embedded key (same as the
  Send Funds flow). Caveat: Circle-managed Google wallets (null stored key) can't sign until
  Circle's wallet API is wired — those users would need an external wallet to commit until then.

The draft contract already supports all four (keeper via `authorizedDrawers`/`drawUsageFor`,
rolling cycle via `cycleStart`/`cycleLength`, per-merchant vault keying; signing is off-chain).

## What's left for me to build (after you deploy)

`test/SubScriptVault.t.sol` covers the commit/draw/owed/withdraw/resume/keeper logic — run
`forge test` to validate before deploying. Once the proxy is deployed on Arc testnet and an
authorized keeper drawer is set, I'll implement: the `metered_vaults` migration, the
accrue+gate rewrite of `report-usage`, the keeper draw job, merchant commit config, the
server-signed commit/withdraw routes, and the user/merchant UI — then verify the full loop.
