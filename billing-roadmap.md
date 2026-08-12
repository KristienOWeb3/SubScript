# Billing Roadmap — Sequenced

Derived from `billing-coverage.md`. Ordered by **what unblocks or forecloses other work**,
not by size or visibility. Verified against branch `revert/pr-119`, 2026-08-10.

---

## A blocker found while sequencing this

**`subscriptions.subscription_id` is the primary key, and there is no contract-address column.**

```prisma
model Subscription {
  subscriptionId  BigInt  @id @map("subscription_id")   // ← PK, no contract binding
  ...
}
```

A redeployed PSA starts `nextSubscriptionId` at 1 again. Every ID it mints **collides with an
existing row.** The mirror, both keepers, the drift healer, and every webhook payload key off a
bare `subscriptionId` that will no longer be unique.

This is not a migration detail to handle during the redeploy. It is a **prerequisite** — and it
sits on the critical path of the entire 🟡 cluster (all seven contract-blocked capabilities).
It's Phase 0 below.

Two viable shapes, decide early because it changes the schema:

- **Composite key** `(contract_address, subscription_id)` — correct, invasive, touches every
  read path.
- **Surrogate key** — internal `id` PK, with `(contract_address, subscription_id)` as a unique
  pair. Less churn at the call sites, extra indirection.

Either way the work is the same class: add `contract_address`, backfill it to the current PSA,
migrate the key, update every consumer. **Do it while there is exactly one contract in play.**
It gets harder the moment two are live.

---

## Phase 0 — Stop the bleeding (this week)

Small, independent, no dependencies. Two are correctness bugs where the product currently
misrepresents itself.

### 0.1 · Auto-recharge: disable the inert UI — **today**

`thresholdUsdc`, `topUpAmountUsdc` and `lastTopUpAt` are live on `MeteredVault` and served by
`/api/user/vault/config` and `/api/user/vault/status`. **Nothing reads them back.** A user who
configures a top-up is told it's active; service then cuts out mid-use with an untouched
setting sitting in the panel.

Ship a stopgap independent of when the keeper lands: disable the inputs, label them
*Coming soon*. Exposed-but-inert is worse than either shipping the feature or hiding the
setting. Keep the persisted values — the keeper will read them as-is.

**Touches:** vault settings UI. Leave the API shape alone.

### 0.2 · Pre-charge renewal reminders

`cron/payment-reminders` scans only `status: PAST_DUE`, so **every reminder in the system fires
after a failure.** Add a second scan on `nextBillingDate` inside a lead window (72h) for
`ACTIVE` subs. The cron already runs on schedule with auth in place.

**Touches:** one query and one DM template.

### 0.3 · Allowance-exhaustion warning

`horizonAllowance` approves ~1 year at signup and is **never topped up.** `customer-billing`
only reads allowance (`route.ts:414`) and fails the renewal with *"insufficient USDC balance or
allowance"* — indistinguishable from being broke. A healthy monthly sub silently dies around
cycle 13.

Two parts, both cheap:
- **Warn:** project `allowance / chargeAmount` = cycles remaining; DM at ≤2.
- **Split the error:** balance-short and allowance-short are different problems with different
  fixes. Say which.

Auto-extending allowance for custodial wallets is the real fix, but it's a spend-authorization
question — deliberately deferred to 2.3.

### 0.4 · Remove `payment.refunded` from the public catalog

It's declared in `events/types.ts:18` and **emitted by nothing.** Integrators building against
the catalog will write handlers that never fire. Either remove it or mark it unimplemented in
the docs, and reintroduce it with the refund path in Phase 2.

**Phase 0 exit:** nothing in the product claims a capability it doesn't have.

---

## Phase 1 — Compliance clock (next 2–4 weeks)

These have external deadlines that aren't set by you.

### 1.1 · Sequential invoice numbering — **start here**

`/api/invoices/[id]/pdf` returns HTML (`Content-Disposition: inline`, `.html` filename) and
numbers invoices from a **UUID slice**. Sequential, gap-free numbering is a hard requirement
under VAT/GST rules in many jurisdictions — this is a compliance exposure, not polish, and it
gets worse with every invoice issued under the current scheme.

Order matters: **numbering before PDF rendering.** Numbering is what's legally load-bearing and
what's painful to retrofit (renumbering issued invoices is not a thing you can do). Rendering
is cosmetic and can follow.

- Per-merchant sequence with a gap-free guarantee — a Postgres sequence per merchant, or an
  advisory-locked counter. Note that "gap-free" and "concurrent" pull against each other; the
  lock is the simpler correct answer at your volume.
- Decide the series format now (prefix, year-reset or continuous). Changing it later means a
  new series.
- Real PDF output afterwards.

### 1.2 · Tax engine — **scope now, build behind a flag**

Zero coverage: nothing matches `vat|sales_tax|tax_rate` anywhere in `src`. Fully off-chain, no
contract constraint — but it touches all three billing models, and retrofitting tax into a
settled on-chain ledger is materially harder than into a card processor, because **you cannot
re-capture a corrected amount after settlement.** The amount has to be right at charge time.

Sequence within this:
1. Decide inclusive vs. exclusive pricing. This is a product decision that changes every
   displayed price and every stored amount. Settle it before writing code.
2. Jurisdiction resolution and a rate table.
3. Tax lines on the invoice (depends on 1.1).
4. Apply at charge time across all three models.

Ship behind a flag. Merchants opt in per-jurisdiction rather than everyone getting it at once.

### 1.3 · Signed usage receipts — **decoupled from arrears, on its own merits**

The self-reported-usage weakness is **live in prepaid PAYG today**, bounded only by the escrow
ceiling: a merchant can report usage up to the full commit with no proof of delivery. That's
the standing gap, independent of whether arrears ever ships.

Build receipt-signing now: merchant submits a usage receipt, the user's client counter-signs,
the keeper draws only against counter-signed accrual. Ships value immediately, and if Option B
arrears ever happens, its hardest prerequisite is already done.

**Phase 1 exit:** no compliance exposure accruing; the metered trust gap closed.

---

## Phase 2 — The credit primitive (4–10 weeks)

The core of the roadmap. Everything here converges on one contract decision.

### 2.1 · Name the actual gap

`PlanReductionNotAllowed` is **not** "reduction is disallowed." It's *"the contract has no way
to represent giving money back."* The Vault has the same property from the other side — it
never creates debt, deliberately.

That single absence blocks, across this codebase:

| Blocked capability | Why |
|---|---|
| Immediate downgrade | Needs credit for unused time |
| Seat reduction mid-cycle | Same |
| Gift cards | Needs a credit balance |
| Refunds beyond a plain transfer | Needs credit representation |
| Arrears Option B | Needs shortfall/debt semantics |

So the redeploy question is not "relax a check." It's **"introduce a credit primitive, and
decide its guarantees."**

### 2.2 · Settle the guarantees — *before* the interface is fixed on-chain

Cheap to decide now, expensive after the ABI ships. At minimum:

- **Symmetry.** A downgrade's credit is computed on the *same basis* as an upgrade's proration
  charge. Otherwise upgrade-then-immediately-downgrade manufactures value through rounding or
  mismatched windows. Reuse `proratedUpgradeDelta`'s exact-integer basis in both directions and
  prove the round-trip is ≤ 0.
- **Modify cooldown.** Rate-limit `modifySubscription` within a billing period, so the round
  trip can't be farmed even at zero net per cycle.
- **Where credit lives.** On-chain balance, or an off-chain ledger settled at next charge? The
  off-chain answer is far simpler and probably right — but it must be decided before the
  interface, because it determines whether the contract needs a credit concept at all.
- **Expiry.** Does credit expire, and does it survive cancellation?

### 2.3 · Bundle everything the redeploy touches

If it ships without addressing reduction and retiming, **all seven blocked capabilities wait
for the redeploy after it.** The bundle:

- Credit / reduction (2.1–2.2)
- **Retiming** — the pause primitive. Skipping keeper runs doesn't work: the skipped sequence
  expires and the next bills on the original schedule. Pause needs a function that shifts
  `nextPayment`.
- **The annual-plan bug.** `compareRecurringRates` compares rate-per-second, so a discounted
  annual plan reads as a *downgrade* from monthly and trips `PlanReductionNotAllowed`. "Switch
  to annual, save 20%" is a default growth lever for subscription products — **treat this as
  broken, not missing.** It's also the clearest single argument for the whole redeploy when
  justifying the work.
- Subscription transfer (mutable subscriber, or an explicit transfer function)
- Currency switching
- Already-pending from prior audits: the arrears-expiry window, Router `totalMerchantLiabilities`,
  surplus-only rescue, `PayoutDelivered`, Confidential `viewKeyHash`

**Hard prerequisite: Phase 0's ID migration must land first.** Two live PSAs without a
contract-address column corrupts the mirror on day one.

### 2.4 · Then the off-chain work it unlocks

Once deployed: immediate downgrade with credit, seat decrease, pause/resume UI, in-place
interval switching, transfer, gift cards, the refund path (re-adding `payment.refunded`).

**Phase 2 exit:** the authorization can be reduced and retimed; seven capabilities unblocked.

---

## Phase 3 — Product surface (parallel, off-chain, no dependencies)

None of this waits on Phase 2. Run it alongside as capacity allows. Ordered by
value-per-effort.

### 3.1 · Auto-recharge, the real implementation
Closes 0.1. Copy the existing keeper shape (`cron/customer-billing`) rather than building
fresh — auth, claim, RPC fallback, dunning are all solved there.

Per cycle: read `balance` and `thresholdUsdc`; where under, pull `topUpAmountUsdc` through the
same allowance-draw path metered billing uses; stamp `lastTopUpAt`; emit `vault.topped_up`.

Two decisions to make deliberately rather than by default:
- **Failed draw** → route into the existing low-balance alert path, *not* a retry loop. A wallet
  that can't fund a top-up won't fund it on retry either, and retrying burns gas to fail.
- **Cooldown independent of balance** → someone sitting right at the threshold shouldn't be
  topped up every single cycle. `lastTopUpAt` already exists for exactly this.

### 3.2 · Lift the one-sub-per-merchant restriction → add-ons
**The contract already permits this.** `activeSubscriptionByPlanKey` is keyed on the exact plan,
so multiple subs to one merchant are legal on-chain. `ACTIVE_MERCHANT_SUBSCRIPTION` is an
API-layer rule. Lifting it gives add-ons, multi-product merchants, and per-seat-as-sibling-sub
for free.

Highest ratio of unlocked surface to work in the document.

### 3.3 · PAYG pricing engine
Flat, tiered, volume, allowance+overage, minimum commitment. Zero chain constraint — it all
resolves to the number the merchant already reports. Largest single cluster of pure product
work. Pairs naturally with 1.3: signed receipts give you the evidence, the rate card gives you
something to check it against.

### 3.4 · Promo codes
The engine exists (percent / fixed / free-trial, windows, caps, once-per-customer). Missing
layer is a `code` column and a redemption endpoint.

### 3.5 · Reactivation as a first-class state
Reactivated customers are **silently promo-ineligible** — a side effect of the once-per-customer
index, not a decision anyone made. Low urgency, but worth deciding explicitly; "current
behavior is fine" is a valid outcome, just make it a choice.

### 3.6 · Trials off-chain
Model no-authorization trials and freemium as DB entitlements with no PSA subscription. Removes
the `amount == 0` and 36-cycle limits as concerns, and converts trial extension from
🟡 contract to 🟢 free.

### 3.7 · Scheduled downgrade *without* the redeploy
Compose cancel-at-period-end with auto-resubscribe at the lower price. Doesn't need Phase 2 —
worth shipping early as a partial answer while the redeploy is in flight.

### 3.8 · Auth-and-capture for one-time
Reuse `SubScriptVault` (`commit` = authorize, `_draw` = capture, surplus withdrawal = void)
rather than building holds. Unlocks pre-orders, deposits, staged fulfillment.

### 3.9 · Port family/team from vaults to subscriptions
Shareable Commit IDs with per-child caps and per-user pause already exist — vault-only.
Entitlement fan-out is off-chain anyway.

### 3.10 · Installments
A PSA subscription with four cycles. Only missing piece is a cycle cap in the keeper.

---

## Phase 4 — Deferred, deliberately

| Item | Why deferred |
|---|---|
| **Arrears Option B** | Only when a specific customer refuses prepay on principle. Then treat it as the credit product it is: underwriting policy, deposit sizing, written collections path. 1.3 is its prerequisite and is already being built on its own merits. |
| **Arrears Option C** (underwritten) | Never. You'd become a lender — bad-debt reserve, capital requirements, lending regulation per jurisdiction. |
| **Grace-period revenue recovery** | 🔴 Genuinely blocked. `PaymentWindowExpired` makes a lapsed period permanently uncollectible; relaxing it reintroduces the back-charge risk the window was added to kill. Grace for *access* is Phase 3 work and unaffected. |
| **Card-network chargebacks** | 🔴 No issuing bank, no forced reversal. The trade you made for finality. Platform-mediated disputes (extending the Vault's `disputeHold` beyond vaults) is the available answer. |
| **ERP reconciliation** | Real, no deadline. After tax lands — it depends on the same tax lines. |

---

## Critical path

```
0.1 disable inert UI ────────────────────────────► (independent, today)
0.2 pre-charge reminders ────────────────────────► (independent)
0.3 allowance warning ───────────────────────────► (independent)
0.4 catalog honesty ─────────────────────────────► (independent)

0.5 ID migration ──► 2.3 PSA redeploy ──► 2.4 unlocked off-chain work
                          ▲
2.1 name the gap ─► 2.2 settle guarantees ┘

1.1 invoice numbering ──► 1.2 tax lines ──► (later) ERP reconciliation
1.3 signed receipts ──────────────────────► (optional) arrears Option B

Phase 3 ─────────────────────────────────► fully parallel, no blockers
```

**Two things gate everything downstream of them:** the ID migration (gates the redeploy, which
gates seven capabilities) and invoice numbering (gates tax, which gates ERP — and is accruing
compliance exposure now).

**Everything in Phase 3 is parallelizable.** If there's a second person, Phase 3 is where they
work while Phase 2's contract decisions get settled.

---

## If only three things happen

1. **Disable the auto-recharge UI today.** The only item where the product actively misleads a
   user into a service interruption.
2. **Do the ID migration before anything else contract-shaped.** It's cheap with one contract
   live and expensive with two — and it silently gates the whole 🟡 cluster.
3. **Settle the credit-primitive guarantees before the ABI is fixed.** Symmetric proration and
   a modify cooldown cost a conversation now and a second redeploy later.
