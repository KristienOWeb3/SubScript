# SubScript — Technical roadmap, timeline, and grant milestones

_Last updated 2026-08-25. Contract state in §1 verified against Arc testnet RPC on that date
(`eth_getCode`, `owner()`, ERC1967 implementation slot)._

SubScript is subscription and usage-based billing infrastructure built natively on Arc. Merchants
get recurring charges, metered billing, escrowed commit vaults, invoicing, payouts, and webhooks,
settled in USDC at a flat 1% fee. The protocol is live on Arc testnet today.

This document is the honest version: what runs, what's blocked, who it's blocked on, and what a
grant buys.

---

## 1. Where we are today (Phase 0, complete)

### Contracts live on Arc testnet (chain 5042002)

| Contract | Address | State |
|---|---|---|
| SubScriptRouter (UUPS proxy) | `0x48188a5729f8B1260cF525aD04f79fE19749f4D4` | impl `0xEb0190BE0CE7c6CB360B5Fb6147C816F6157ef0d` |
| SubScriptVault (UUPS proxy) | `0xBe5254CEa07c3f3f0827A70e070C1629732945f9` | impl `0xd442cd10f588f1f501bd4bd2ab5210ac476a53db` |
| SubScriptPSA + Confidential | `0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2` | 14,198 bytes |
| MockStableFX (placeholder) | `0xD0c699768d0e92657D5E5b96CEC3546197b2Fa9c` | stands in until Arc publishes an FX router |

- **SubScriptPSA** — keeper-triggered recurring ERC-20 pulls. Per-authorization payment token,
  settlement token, period, and a `maxPaymentAmount` ceiling that bounds FX slippage. Introductory
  pricing and free trials are a pure function of the billing sequence number, so there's no mutable
  phase counter to drift or manipulate.
- **SubScriptRouter** — merchant settlement as a pull-payment ledger, 1% protocol fee, tier-gated
  payout redirection, and a `totalMerchantLiabilities` counter so the owner can never sweep funds
  merchants are owed.
- **SubScriptVault** — escrowed prepaid commits for metered billing. Platform-fixed 2 USDC exposure
  cap per user→merchant per cycle, keeper-only settlement bounded by escrow and the accepted usage
  ledger, disputes block settlement and reclaim, unused funds return to the user.
- **SubScriptConfidential** — access-gated batch payouts with commit-reveal view-key registration.
  Today this is governed *read* access, not cryptographic privacy. See §5.

### Circle and Arc products already integrated

| Product | Status | Notes |
|---|---|---|
| USDC as native gas | Live | Arc's native currency is USDC at 18 decimals on the EVM; the 6-decimal representation is the ERC-20 face only. Both are handled explicitly. |
| Circle Programmable Wallets (dev-controlled SCA) | Live | Full custody cutover complete. Every signing site — vault, subscriptions, permit-sign, wallet send, contract execution — runs through a `WalletCustody` seam. No self-managed key material remains. |
| Gas sponsorship | Live, own implementation | A sponsor EOA credits native USDC before sponsored actions. Not yet Circle Paymaster proper. |
| CCTP V2 inbound | Live | Arc `MessageTransmitterV2` at `0xE737e5cE…`, `localDomain()` verified as 26. Ethereum → Arc USDC funding works. |
| Arc native L1 memos | Live | `executeWithMemo` attaches a human-readable reference to settlement, which is what receipts and reconciliation need. |
| Arc FX | **Mock only** | Arc publishes no StableFX router. Only `FxEscrow 0xd68256f4D69C6BbEcB873D8588AE0Dc6B8E22E10` and Permit2 exist as of 2026-08-24. |

### Platform surface

Merchant dashboard, customer dashboard, admin console with scoped roles and kill switches,
hosted checkout, payment links, API keys with test/live modes, signed webhooks with delivery logs,
PWA with offline policy, KYC/KYB case lifecycle with provider handoff, payroll batch payouts, an
NGN bank-transfer funding sandbox, and a public-beta legal set. Keepers run on Vercel cron plus
GitHub Actions.

### Known gaps, stated plainly

- Contract ownership is a single EOA (`0x59e6970E`), not a Safe. The env var calls it
  `MULTISIG_ADDRESS`; it has no bytecode.
- No external security audit yet.
- No chain-event indexer. On-chain state syncs when our own code touches a subscription; a
  reconcile cron heals drift, but it isn't a listener.
- `SubScriptVault.sol` in the repo is a V3 candidate; the live proxy runs an earlier implementation.
- `sk_live_` API keys are refused platform-wide, deliberately.
- Sub-daily keepers live in GitHub Actions because the hosting tier allows daily cron only. That
  split has produced 3–55 minute webhook lag on cancel and resume events.

---

## 2. What blocks mainnet, and who owns each blocker

Two blockers sit outside our control. Both were re-verified 2026-08-24.

**Arc mainnet is not published.** Arc's own contract-address reference states that mainnet
addresses are not yet available, and its connect page lists only testnet (5042002). Every mainnet
value in our config — chain ID 5042001, `rpc.mainnet.arc.network`, `arcscan.app`, CCTP domain 26 —
is a placeholder. Arc also moved its docs and RPC hosts from `arc.network` to `arc.io`.

**Circle does not support Arc mainnet.** Circle's supported-blockchains list carries `ARC-TESTNET`
under testnets and has no `ARC` row in the mainnet table. Our fail-closed gate requires
`CIRCLE_ARC_BLOCKCHAIN=ARC` in mainnet mode, which is a value Circle currently rejects. Circle
sandbox wallets also cannot migrate to a live key, so mainnet means every user gets a new address —
that identity migration is real work, already specified in the cutover runbook.

We've engineered around both rather than waiting. `assertFinancialNetworkReady()` refuses to serve
any financial route if mainnet mode is selected with incomplete or malformed configuration, so the
platform physically cannot settle real money against test contracts. Cutover is a deploy, not a
runtime toggle, which is also what makes it reversible.

**The consequence for this roadmap:** everything through Phase 2 is unblocked and proceeds on our
own schedule. Phase 3 onward is trigger-gated on Arc and Circle. We're building toward being
deployment-ready on day one of Arc mainnet rather than starting then.

---

## 3. Phase 1 — Harden the money path (Sept–Oct 2026)

Nothing here depends on an external party. This is the work that has to be finished before real
USDC is a defensible idea.

| # | Milestone | Deliverable / proof |
|---|---|---|
| M1 | External smart-contract security audit of Router, PSA, Confidential, and Vault V3 | Published audit report plus a remediation diff and re-review sign-off |
| M2 | Safe multi-sig ownership | Router, Vault, and PSA ownership transferred to a Gnosis Safe on testnet; pause, unpause, and a UUPS upgrade all rehearsed; tx hashes published |
| M3 | Vault V3 upgrade | Storage-layout equivalence check green against `SubScriptVaultPredecessor`, Foundry and Hardhat vault suites green, proxy upgraded |
| M4 | Chain-event indexer | A listener that makes on-chain state authoritative instead of reconcile-only, with a replay path from any block height and a drift dashboard |
| M5 | Endpoint and config hygiene | RPC hosts migrated to `arc.io`; testnet CCTP `tokenMessenger` corrected; RLS enabled on fiat funding tables; vault address env fallback validated like every other address |
| M6 | Load and failure testing | Keeper throughput at 10k active subscriptions; documented behavior under RPC rate-limit exhaustion, keeper outage, and sponsor-wallet depletion |

Arc's public RPC rate-limits at roughly one call per second per IP and counts batched calls
individually, so M6 matters more here than it would elsewhere. We already run a custom retry layer
beneath viem because its own retry logic doesn't recognize Arc's `-32011` response.

---

## 4. Phase 2 — Circle product depth (Nov 2026 – Jan 2027)

All on testnet. This is where the grant produces the most visible Circle-ecosystem output.

| # | Circle / Arc product | Milestone | Deliverable / proof |
|---|---|---|---|
| M7 | Arc FxEscrow + Permit2 | Replace MockStableFX with the real FX path | A cross-currency subscription — subscriber pays USDC, merchant settles EURC — executing on testnet through `FxEscrow`, with `maxPaymentAmount` proven to bound slippage in an adversarial test |
| M8 | Circle Paymaster / Gas Station | Move sponsorship from our own sponsor EOA to Circle Paymaster | Sponsored-transaction dashboard, per-merchant and per-wallet sponsorship limits, budget alarms, and a documented fallback when sponsorship fails |
| M9 | CCTP V2 outbound | Merchant payouts from Arc to any CCTP domain | A merchant withdrawing settlement to Ethereum, Base, and Arbitrum, with attestation status surfaced in the dashboard |
| M10 | CCTP V2 hooks + Fast Transfer | One-action cross-chain subscribe | A user on Base subscribing in a single action: bridge-in triggers a hook that activates the subscription on arrival, with no second signature |
| M11 | Circle Compliance Engine | Sanctions and risk screening on the money path | Screening on merchant onboarding and on subscriber first charge, with decisions recorded in the append-only KYC case history |
| M12 | Circle production wallet readiness | A rehearsed live-credential path | Production wallet-set provisioning rehearsal, recovery-ciphertext procedure documented and tested, and the §1.5 identity migration executed against a staging cohort |

M7 carries a hard constraint worth calling out: `SubScriptPSA.stableFXRouter` is `immutable`, so the
FX router address must be final before the PSA bytecode is deployed. That makes M7 a prerequisite
for the mainnet PSA deployment, not a follow-on.

---

## 5. Phase 3 — Arc mainnet cutover (trigger-gated, earliest Q1 2027)

This phase starts when both external conditions clear, not on a date:

1. Arc publishes mainnet chain ID, RPC endpoints, canonical USDC address, and CCTP domain.
2. Circle adds Arc to its mainnet supported-blockchains list with a confirmed blockchain identifier.

| # | Milestone | Deliverable / proof |
|---|---|---|
| M13 | Mainnet deployment | Router, Vault, and PSA deployed with fresh keys, owned by the Safe from M2, addresses published |
| M14 | Live money path smoke test | Signup → fund → checkout → subscription → keeper renewal → cancel → webhook, executed with real USDC and published as a transaction trail |
| M15 | Live API keys opened | `sk_live_` enabled, with the platform-wide refusal removed only after M13 and M14 pass |
| M16 | Rollback rehearsed | A documented and tested revert to testnet configuration, since cutover is a deploy |

We are deliberately not building a runtime mainnet switch. Every contract address is a build-time
constant that Next.js inlines into the client bundle, so a database flag would leave the server on
mainnet and the browser on testnet. A toggle also can't re-provision wallets, which is the actual
work.

---

## 6. Phase 4 — Privacy Premium on ArcaneVM (trigger-gated, Q1–Q2 2027)

This is the roadmap item with the highest commercial leverage, and it's the one most specific to
Arc.

A transparent ledger publishes a merchant's MRR, churn, customer list, per-customer pricing, and —
if they use batch payouts — their payroll. That is not a rounding error in the value proposition;
it's the reason serious companies won't move billing on-chain. Per-customer pricing is the sharpest
case: the moment an enterprise customer can read what a smaller customer pays, every renewal races
to the lowest published number. Public pricing doesn't leak information, it removes the merchant's
ability to price.

Arc's Privacy Sector is the only model that fits payments. ZK rollups hide nothing at the
application layer without custom circuits. Shielded pools are compliance-radioactive for a
merchant-facing payments company and destroy the audit trail. Permissioned chains cost you the
settlement asset. Governed visibility — opaque to the public, disclosable to named parties under
policy — is how bank rails already work.

| # | Milestone | Deliverable / proof |
|---|---|---|
| M17 | Trust-domain configuration | Merchant billing data isolated in a trust domain with a documented policy set |
| M18 | Function-level access policies | Role-scoped disclosure: merchant sees own ledger, platform sees fee accrual, auditor gets a scoped view key |
| M19 | Trustee disclosure flow | An end-to-end selective-disclosure run: an auditor reading a merchant's ledger under policy while a third party provably cannot |
| M20 | Confidential payroll | Batch salary payouts where amounts are not publicly derivable, with a written isolation proof |

Until M17–M20 land, customer-facing copy says *governed visibility roadmap* and *confidential
execution*, never *your transactions are private*. A merchant could disprove the second claim on
arcscan in four minutes, and that's not a trust hole worth digging.

---

## 7. Phase 5 — Developer experience and ecosystem (continuous, Q2 2027+)

| # | Milestone | Deliverable |
|---|---|---|
| M21 | `subscript listen` | Local webhook forwarding, the highest-leverage DX gap |
| M22 | Subscription test clocks | Deterministic time travel through billing cycles |
| M23 | Agent-native integration | MCP registry listing, agent `SKILL.md`, and a nightly agent-integration benchmark in CI |
| M24 | Invoicing and dunning | First-class invoices; configurable Day 1/3/7 retries with reminders, webhooks, and auto-suspend |
| M25 | Sponsor / pay-for-me | Third-party subscription funding |

---

## 8. Timeline at a glance

```
2026    Sep ── Oct ── Nov ── Dec ── 2027 Jan ── Feb ── Mar ── Apr ── May ──▶

Phase 1  ████████████                          Audit, Safe, indexer, Vault V3
Phase 2         ██████████████████████         Circle FX, Paymaster, CCTP, Compliance
Phase 3                        ░░░░░░░░░░░░    Mainnet — trigger-gated on Arc + Circle
Phase 4                              ░░░░░░░░  ArcaneVM — trigger-gated on Arc
Phase 5         ────────────────────────────▶   Continuous DX

████ committed    ░░░░ trigger-gated on external publication
```

---

## 9. How this grant supports the roadmap

The grant is what converts Phase 1 and Phase 2 from a backlog into shipped work, and it's targeted
at costs that a self-funded team genuinely cannot absorb.

### External security audit — the largest single line item

M1 is the hard gate on everything downstream. Pointing real USDC at unaudited upgradeable contracts
is not a risk we'll take, and an audit of four contracts including a UUPS upgrade path is the
biggest cash cost on the roadmap. Grant funding here directly unblocks M13 through M16. We've done
what internal review can do — three source-level findings already fixed, a predecessor contract kept
solely for storage-layout tests, adversarial tests including a reentrancy attacker — but internal
review is not an audit and we won't present it as one.

### Engineering time on Circle integration depth

M7 through M12 are the deliverables that produce visible Circle-ecosystem output: real FX through
Arc's FxEscrow, Circle Paymaster sponsorship with proper limits and monitoring, bidirectional CCTP
with hooks so a cross-chain subscribe is one action, and Compliance Engine screening on the money
path. Each is weeks of focused work, and each is currently competing with keeping the testnet
platform running. Funding buys the focus.

### Infrastructure that removes a real correctness problem

Our hosting tier permits daily cron only, so sub-daily keepers run from GitHub Actions. That split
has caused 3–55 minute lag on cancel and resume webhooks — a genuine correctness issue for
merchants, caused by a billing tier rather than by a design flaw. Grant funding covers proper
hosting, a dedicated RPC tier that ends the one-call-per-second contention, and the monitoring and
status page that a payments product needs to be taken seriously.

### Sponsorship and gas float

The product promise is that users pay the advertised price with no hidden network fee. That means we
carry sponsorship. On Arc the cost is low and predictable because gas is USDC, which is exactly why
the promise is credible here and nowhere else — but at mainnet volume it's still a float we have to
fund, and an unfunded sponsor wallet is a user-visible failure.

### Compliance onboarding

M11 needs a licensed identity and screening provider with signed webhooks and sanctions/PEP
coverage. The case lifecycle, provider handoff, and append-only transition history are already
built. What's missing is the commercial relationship, which is a cost rather than a code problem.

### What we're not asking the grant to fund

Everything in §1 already exists and was self-funded: the contracts, the full Circle wallet custody
cutover, both dashboards, the admin console, checkout, webhooks, the KYC lifecycle, and the
fail-closed mainnet gate. We're asking for the audit, the Circle integration depth, and the
infrastructure — not for a runway to build the product.

### What the grant buys Arc and Circle

By the end of Phase 2 there is a working, audited, Safe-governed subscription and metered-billing
protocol sitting on Arc testnet with every Circle product wired in and a rehearsed cutover runbook.
On the day Arc publishes mainnet parameters and Circle adds Arc to its mainnet blockchain list, we
deploy rather than begin. Recurring revenue infrastructure is the reason a merchant keeps a balance
on a chain instead of bridging in and out, and it's a category Arc doesn't have yet.
