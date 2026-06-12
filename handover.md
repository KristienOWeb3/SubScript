# Handover Documentation - Payment Link Hardening & ZK Gating Audit

This handover document summarizes the architecture reviews, security hardening designs, UI adjustments, and active subagent processes initiated during this session. It serves as a guide for the next developer/agent to pick up execution.

---

## 1. Current Session Focus & Status

The primary goal of this session was to draft the **Master Implementation Plan** for Hosted Payment Links and ZK Gating audits, resolving critical security issues identified in the audit comments, and preparing the workspace for execution.

### Active Artifacts
* **Master Implementation Plan**: [implementation_plan.md](file:///C:/Users/Kristien/.gemini/antigravity/brain/1db4f56a-8ef2-4fad-b239-d8f82712ab6c/implementation_plan.md)
  - *Status*: **Awaiting User Review/Approval**. Set to `request_feedback: true` so the user can review and approve it.
  - *Details*: Outlines the exact steps for payment link generation, ephemeral receiver wallet derivation, verification webhook validation, log decoding, and strict tier gating.

### Active Background Subagents
We have three subagents running in the background to handle parallel tasks:
1. **Smart Contract Researcher** (`7ba92551-b209-466a-8d8b-e57ed4469ebc`)
   - *Task*: Researching the Solidity contract architecture (`SubScriptPSA.sol`, `SubScriptRouter.sol`) and identifying StableFX/CCTP/EURC integration points.
2. **Frontend Dashboard Researcher** (`73969f4a-34fe-4344-8c59-5bf01b2a2616`)
   - *Task*: Investigating transaction loading states, confirmation indicators, toast library dependencies, and references to Malachite consensus.
3. **UI Nomenclature Updater** (`0fa0859f-5c6d-4495-9990-58a8d7076ae5`)
   - *Task*: Updating UI components to rename "Premium" reference variants to "Privacy Premium", and adjusting premium plan prices from 10 USDC to 50 USDC.
   - *Note*: Ensure this subagent completes and writes its changes before starting manual modifications of the affected files (such as `src/app/dashboard/upgrade/page.tsx` and `src/lib/payments/constants.ts`).

---

## 2. Hardened Architecture for Hosted Payment Links

To eliminate accounting vulnerabilities and identity replay attacks, we designed the following payment flows:

### Ephemeral Wallet Derivation (Replay Prevention)
- Instead of paying directly to the merchant's master wallet (which makes distinguishing between identical invoice amounts impossible), each generated payment link derives a unique, random ephemeral wallet (`receiver_address` and `receiver_private_key`).
- **Direct Transfer (Arc)**: Payer transfers USDC directly to the ephemeral address on the Arc Network.
- **CCTP Deposit (Sepolia)**: Payer calls `depositForBurn` with `mintRecipient` set to the ephemeral address (padded to `bytes32`). USDC is minted directly to the ephemeral address on Arc.
- **Auto-Sweeping**: On verification, the backend sweeps the balance from the ephemeral address to the merchant's destination wallet (paying gas in USDC since it is Arc's native token).

### Atomic Settlement
- Replaced non-atomic backend queries with a Postgres function or conditional update:
  ```sql
  UPDATE payment_links
  SET status = 'PAID', paid_at = NOW(), verified_tx_hash = $1
  WHERE id = $2 AND (status = 'PENDING' OR status = 'PENDING_CONFIRMATION');
  ```
- Asserts that rows affected equals 1, and inserts append-only ledger logs in the same atomic database transaction to prevent race conditions.

### RPC Log Decoding
- Instead of using `transaction.value` (which is `0` for ERC-20 token contract calls), the verification webhook decodes the `Transfer(address from, address to, uint256 value)` log directly from the USDC contract receipt.

---

## 3. ZK Privacy Feature Gating

We enforced strict feature Gating to restrict Arc L1 Confidentiality to Premium tier merchants while keeping CCTP/StableFX universally free.

### Backend Endpoints
- **GET `/api/merchant/confidentiality`**: Overrides and returns `shielded_payouts_enabled: false` if merchant is `'FREE'`.
- **POST `/api/merchant/confidentiality`**: Rejects updates with `403 Forbidden` if merchant is `'FREE'`.
- **POST `/api/premium/withdraw/batch`**: If merchant is `'FREE'` and requests `isShielded = true`, the request is immediately rejected with `403 Forbidden` (no silent degradation to transparent routing).

### Dashboard Settings View (`src/app/dashboard/page.tsx`)
- Disable Shielded Batch Payouts toggles and View Key generators for Standard/Free tier merchants.
- Display a Lucide React `<Lock />` icon next to the disabled options.

---

## 4. Immediate Next Steps for Next Session

1. **Wait for Plan Approval**: Ensure the user approves the [master implementation plan](file:///C:/Users/Kristien/.gemini/antigravity/brain/1db4f56a-8ef2-4fad-b239-d8f82712ab6c/implementation_plan.md).
2. **Collect Subagent Outputs**:
   - Check the progress of the active subagents using `manage_subagents` -> `list`.
   - Read their logs/messages once they complete.
   - Verify that UI updates by `nomenclature_updater` (renaming references to 'Privacy Premium' and updating pricing to 50 USDC) are written correctly.
3. **Database Setup**:
   - Run SQL scripts to update the database schema and add columns (`receiver_address`, `receiver_private_key`, `status`, `paid_at`, `verified_tx_hash`, `settlement_reference`, snapshots, etc.) to the `payment_links` table.
   - Update `prisma/schema.prisma` to keep the schemas in sync.
4. **Implement Backend Endpoints**:
   - Write `src/app/api/merchant/links/route.ts` (Phase 1 Generation).
   - Write `src/app/api/webhooks/verify-checkout/route.ts` (Phase 4 Verification).
5. **Update Checkout Pages**:
   - Update `src/app/pay/[id]/page.tsx` (Phase 2 Server-side Guards & SEO).
   - Update `src/app/pay/[id]/PublicPayClient.tsx` (Phase 3 Payer Execution Logic).
6. **Harden Gating logic**:
   - Modify `src/app/api/merchant/confidentiality/route.ts`, `src/app/api/premium/withdraw/batch/route.ts`, and `src/app/dashboard/page.tsx` as detailed in the plans.
