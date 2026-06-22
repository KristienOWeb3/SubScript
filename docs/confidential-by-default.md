# Confidential-by-default for merchant transactions

**Goal:** every merchant-associated transaction is privacy-guarded on Arc by default — not only on
the paid Privacy Premium tier.

**Revenue model (decided):** baseline transaction confidentiality is **free** for all merchants;
**Privacy Premium stays paid** for advanced controls (trust domains, function-level selective
disclosure, confidential payroll, batch payouts).

## Current on-chain reality
Confidential routing exists only in the Premium batch-payout path (`CONFIDENTIAL_CONTRACT
.executeBatchPayout(..., isShielded, viewKey)`). Regular withdrawal and inbound checkout are public
at the contract level, so full confidential-by-default needs contract work, not just config.

## The footgun (enforced against)
Never silently fall back to a public transaction when a "shielded" merchant has no view key — that
leaks to the public ledger. Confidential-by-default must **fail closed** (block + prompt setup).

## Phase 0 — shipped in this change (safe, no contract changes)
- **De-paywalled** baseline confidentiality: `merchant/confidentiality` and `execute-tx`
  `registerViewKey` no longer require Premium. Any merchant can enable shielding + register a view
  key for free.
- **Fail-closed guard:** batch payout returns 409 when shielded is enabled but no view key is
  registered (never downgrades to a public payout).
- **Default intent:** new merchants default `shielded_payouts_enabled = true`
  (migration `20260625000000`). Existing merchants unchanged. Safe because of the guard.

## Phase 0 — remaining
- **Auto view-key provisioning for embedded-wallet merchants:** the server already custodies their
  key, so generate a view key on first confidential use, encrypt it (`WALLET_ENCRYPTION_KEY`), store
  it, and submit `registerViewKey` via the sponsored `execute-tx` path. External-wallet merchants
  complete a one-time signature instead. This is the part that touches key custody + the batch-payout
  view-key flow, so it gets its own tested pass.

## Phase 1 — confidential regular withdraw (contract work + testnet/audit)
Add a confidential withdraw entry point so `execute-tx` `withdraw` routes through
`CONFIDENTIAL_CONTRACT` instead of the public router.

## Phase 2 — confidential inbound checkout (contract work + receipt rework)
Confidential `depositForMerchant` variant; rework the public `DepositWithMemo` receipt-binding in
`payment-links/verify` for the confidential event shape, preserving selective disclosure.

## Phase 3 — flip defaults everywhere + backfill once keys exist.
