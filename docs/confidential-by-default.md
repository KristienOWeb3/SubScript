# Confidential-by-default for merchant transactions — implementation plan

**Goal (from product):** every transaction associated with a merchant account is privacy-guarded on
the Arc ledger by default — not only when a merchant pays for Privacy Premium.

This document is the engineering plan. It is intentionally a plan rather than a blind code change,
because the work touches the payout/withdraw **contract path** and merchant key custody, where a
mistake can lock or publicly leak funds.

---

## 1. Current state (what's actually confidential today)

| Merchant transaction type | Path today | Confidential? |
| --- | --- | --- |
| Inbound checkout / payment links | `SubScriptRouter.depositForMerchant` → emits public `DepositWithMemo` | ❌ public |
| Regular withdrawal | `execute-tx` `withdraw` → `SUBSCRIPT_ROUTER` | ❌ public |
| **Batch payout** | `premium/withdraw/batch` → `CONFIDENTIAL_CONTRACT.executeBatchPayout(..., isShielded, viewKey)` | ✅ only when `shielded_payouts_enabled` **and** a registered `view_key_hash` |

Gates that make confidentiality paid/opt-in today:
- `merchant/confidentiality` POST and `execute-tx` `registerViewKey` both require `tier !== 'FREE'`.
- Batch payouts themselves require `tier === 'PREMIUM'` ([premium/withdraw/batch/route.ts:96](../src/app/api/premium/withdraw/batch/route.ts)).
- `merchants.shielded_payouts_enabled` defaults to `false`.

**Conclusion:** confidential routing only exists inside the Premium batch-payout feature. You cannot
make all merchant transactions confidential by flipping config alone — the standard withdraw and
inbound checkout paths have no confidential variant at the contract level.

---

## 2. The footgun to avoid

Do **not** simply default `shielded_payouts_enabled = true` and fall back to a public transaction
when a merchant has no view key. That silently downgrades a merchant who believes they're private to
a **public** on-chain transaction. Confidential-by-default must *fail closed* (block + prompt to
finish setup), never fail open to a public ledger entry.

---

## 3. Required building blocks

### 3.1 View-key provisioning (prerequisite for everything)
Shielding requires each merchant to have a view key whose hash is registered on-chain
(`registerViewKey`). Today this is manual + Premium-gated.

- **Embedded-wallet merchants** (server already custodies their key): auto-generate a view key on
  merchant creation, encrypt it with `WALLET_ENCRYPTION_KEY` (same scheme as `lib/crypto.ts`), store
  it, and submit `registerViewKey` via the sponsored `execute-tx` path. Fully automatic.
- **External-wallet merchants** (non-custodial): cannot auto-provision. Prompt a one-time
  "Enable confidential transactions" signature during onboarding that registers their view key.
  Until they complete it, their merchant transactions cannot be shielded — surface this clearly.

### 3.2 Contract work (the part that needs an audit + testnet rollout)
- **Confidential regular withdraw:** add a confidential withdraw entry point so `execute-tx`
  `withdraw` can route through `CONFIDENTIAL_CONTRACT` instead of `SUBSCRIPT_ROUTER`.
- **Confidential inbound:** a confidential `depositForMerchant` variant (or routing inbound merchant
  settlement through the confidential contract) so checkout/payment-link receipts don't emit a public
  amount/merchant on-chain. This is the largest piece; the memo/receipt-binding logic in
  `payment-links/verify` assumes the public `DepositWithMemo` event and must be reworked for the
  confidential event shape.
- Keep selective disclosure working: authorized viewers (payer, merchant, treasury, invited) must
  still resolve receipts via the existing app-layer access control + view key.

### 3.3 Policy / data
- New migration: `shielded_payouts_enabled` default `true` — **only after** 3.1 is live so new
  merchants always have a key.
- Backfill existing merchants once they have keys.
- Remove the `tier`-based paywall on `merchant/confidentiality` + `registerViewKey` so baseline
  confidentiality is free.

---

## 4. Revenue-model decision (needs product sign-off)

The whitepaper sells **Privacy Premium ($10/mo)** as a paid tier. Making baseline transaction
confidentiality free changes that. Recommended split:
- **Free / default:** every merchant transaction is shielded on-chain (this initiative).
- **Privacy Premium (still paid):** advanced controls — trust domains, function-level selective
  disclosure, confidential payroll, batch payouts, audited withdrawal reporting.

This keeps the revenue tier meaningful while honoring "merchant transactions are private by default."

---

## 5. Suggested phased rollout (each phase shippable + reversible)

- **Phase 0 (off-chain prep, no contract risk):** auto-provision view keys for embedded-wallet
  merchants; de-paywall `registerViewKey` + `merchant/confidentiality`; add a fail-closed guard so a
  shielded merchant without a key is blocked (not downgraded to public). No default flip yet.
- **Phase 1:** confidential regular withdraw (contract entry point + `execute-tx` routing) on testnet,
  then mainnet behind a feature flag.
- **Phase 2:** confidential inbound checkout + receipt-binding rework.
- **Phase 3:** flip `shielded_payouts_enabled` default to `true`, backfill, make confidential the
  default everywhere.

---

## 6. What I can implement immediately on your go-ahead

Phase 0 above is safe and self-contained (no contract changes, fails closed). Phases 1–2 require
contract changes + a testnet pass + (ideally) an audit before they touch mainnet money flow. Tell me
which phase to start and I'll build it.
