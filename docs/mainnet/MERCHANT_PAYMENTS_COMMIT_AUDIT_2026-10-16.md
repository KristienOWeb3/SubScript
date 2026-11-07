# Merchant subscriptions, payment flows and commit latency audit

Audit date: 16 October 2026. Verdict: **REQUEST CHANGES**.

Three independent agents reviewed subscription lifecycle, payment execution/recovery, and commit latency. The lead cross-checked the current worktree, ran the existing suites, reproduced contract/metric behavior, and queried production state read-only.

**Six HIGH and six MEDIUM findings remain. Green existing suites do not establish the missing financial and recovery invariants.** This pass adds audit documentation and local evidence; it does not deploy or change application/contract behavior. The pre-existing uncommitted billing, catalog and telemetry implementation remains under review.

## 1. Scope and coverage

| Area | Reviewed boundaries | Verification |
| --- | --- | --- |
| Merchant catalog | Session/API-key plan creation and PATCH, limits, checkout publication, targeted consumption, immutable price/cadence | Source review and actual-handler VM reproduction; existing catalog tests |
| Subscription activation | Checkout and embedded activation, on-chain/mirror binding, retry identities, contract deployment scoping | Source review, subscription regressions, local PSA execution |
| Subscription lifecycle | Renewal, dunning, cancellation, resume, upgrade credit, drift healing, lifecycle webhooks, external versus custody wallets | Runtime contract/healer reproductions and 42 focused existing tests |
| Wallet payments | Single/batch, delegated reservations, partial success, recipient blocks, fee and cap reconciliation, PIN boundaries, generic execution | Source review and actual generic-handler VM reproduction |
| Checkout settlement | Merchant/peer links, router memo and receipt proof, replay, atomic settlement, durable email/DM/webhook effects | Source review, existing PostgreSQL/recovery tests, actual COMPLETED callback reproduction |
| Cross-chain payments | Withdrawal fee/approval/burn, registration, worker selection and attestation recovery | Source review and accepted-burn timeout reproduction with custody mocked |
| Vault payments | Commit, withdraw/reclaim/claim, durable receipt recovery and confirmed-event matching | Source review and existing receipt/recovery tests |
| Commit latency | Browser recovery, PIN/preflight, approval, custody, Arc finality, intent/mirror writes, refresh, admin probes/metrics | Source review, contract/metric reproduction, read-only DB/RPC readiness probes |

## 2. Confirmed HIGH findings

### S1. Resuming can authorize full-price charges at a shortened permanent cadence

**Sources:** [`resume/route.ts:178`](../../src/app/api/user/subscription/resume/route.ts#L178), [`resumeBridge.ts:27`](../../src/lib/subscriptions/resumeBridge.ts#L27), [`SubScriptPSA.sol:341`](../../contracts/SubScriptPSA.sol#L341).

Resume creates an authorization whose amount is the full plan price and whose permanent period is only the time remaining in the already-paid period. The mirror continues to use the original plan period, but `executePayment` is permissionless: a merchant or any other caller can execute every window the contract authorizes.

**Reproduced:** a 10 USDC monthly plan resumed with a one-day bridge allowed an arbitrary local signer to collect two full 10 USDC payments one day apart. The subscriber's mock balance fell from 1,000 to 980 USDC. This was an isolated Hardhat network, not a live wallet.

**Required remediation:** preserve the original recurring cadence in the authorization itself. Keeping the original first billing date as well requires supported on-chain start-date terms or a deferred reauthorization design; keeper-only scheduling cannot secure a permissionless contract. Refusing mismatched bridge terms is containment, not a complete resume implementation.

**Release regression:** after resuming with one day left, an arbitrary caller must be unable to collect a second full monthly price one day after the first charge.

### S2. Paid-through calculations use an immutable first due date

**Sources:** [`cancel/route.ts:65`](../../src/app/api/user/subscription/cancel/route.ts#L65), [`resume/route.ts:109`](../../src/app/api/user/subscription/resume/route.ts#L109), [`upgrade/route.ts:264`](../../src/app/api/user/subscription/upgrade/route.ts#L264), [`SubScriptPSA.sol:287`](../../contracts/SubScriptPSA.sol#L287).

`nextPayment` is set when authorization is created. Renewals use sequence windows and do not advance this field. Cancellation, resume and upgrade nevertheless treat it as the subscriber's current paid-through date. After a successful renewal, cancellation can expire paid access immediately, resume can return `PERIOD_ALREADY_ENDED`, and upgrade can omit the renewed period's credit.

**Reproduced:** executed a regular monthly authorization's first renewal and asserted that its `nextPayment` still equaled the original first due timestamp.

**Required remediation:** a shared, authoritative entitlement calculation based on confirmed executed settlement sequences and applicable terms, including trial/introductory periods. Avoid substituting an unverified mirror date. Test cancellation, resume and upgrade after multiple renewals and third-party permissionless execution.

### S3. Drift healing cancels access that was intentionally preserved until period end

**Sources:** [`driftHealer.ts:81`](../../src/lib/subscriptions/driftHealer.ts#L81), [`driftHealer.ts:132`](../../src/lib/subscriptions/driftHealer.ts#L132).

Ordinary scheduled cancellation revokes future on-chain billing immediately while retaining ACTIVE entitlement until paid-through. The healer omits scheduling/paid-through fields from its read and treats every ACTIVE mirror plus inactive authorization as an immediate terminal cancellation.

**Reproduced:** executing the actual healer against a mocked ACTIVE scheduled cancellation paid through tomorrow immediately wrote `CANCELED` and emitted `subscription.canceled`.

**Required remediation:** distinguish authorization revocation from entitlement expiry. Scheduled access must survive reconciliation until its verified paid-through date; emit the terminal event only at actual expiry. Test both embedded and external-wallet revocations and repeated healer passes.

### P1. Generic USER transfers bypass the canonical spending and recipient policies

**Sources:** [`execute-tx/route.ts:50`](../../src/app/api/execute-tx/route.ts#L50), [`execute-tx/route.ts:342`](../../src/app/api/execute-tx/route.ts#L342), [`execute-tx/route.ts:589`](../../src/app/api/execute-tx/route.ts#L589), [`spendingLimits.ts:14`](../../src/lib/spendingLimits.ts#L14). Compare [`wallet/send/route.ts:189`](../../src/app/api/user/wallet/send/route.ts#L189) and [`wallet/send/route.ts:242`](../../src/app/api/user/wallet/send/route.ts#L242).

The generic execution route permits USER `transferUsdc` but never calls the canonical cumulative spending reservation or blocked-recipient guard. Authentication, Tier 1 and a valid PIN do not replace those controls.

**Reproduced:** the actual handler, with external boundaries mocked, accepted a Tier 1 transfer of `2501000000` micro-USDC (2,501 USDC), returned HTTP 200 and invoked custody. The spending and block guards were called zero times. Tier 1's daily ceiling is 2,500 USDC.

**Required remediation:** route USER payments through the canonical policy boundary or reuse its full reservation/reconciliation and recipient checks. Audit peer embedded checkout under the same boundary. Preserve merchant payout semantics explicitly. Test over-cap, blocked-recipient, ambiguous-acceptance and replay cases on every callable transfer endpoint.

### P2. Accepted CCTP burns can fall outside automatic recovery

**Sources:** [`cctp/withdraw/route.ts:219`](../../src/app/api/user/cctp/withdraw/route.ts#L219), [`cctp/withdraw/route.ts:237`](../../src/app/api/user/cctp/withdraw/route.ts#L237), [`attestationWorker.ts:132`](../../src/lib/cctp/attestationWorker.ts#L132), [`constants.ts:354`](../../src/lib/contracts/constants.ts#L354).

The withdrawal submits the burn without durably recording the accepted provider transaction ID. `burn_tx_hash` is saved only after custody confirmation. A timeout or crash after acceptance leaves the bridge row at `pending_fee`/`pending_burn`, while the attestation worker selects only `pending_attestation` or stale `minting` rows with a burn hash.

**Reproduced:** mocked custody accepted fee/approval, then threw a confirmation timeout after burn acceptance. The route returned HTTP 400. No submission had an `onSubmitted` callback; writes retained the fee hash and error but neither the burn hash nor provider ID. The worker cannot select the resulting row.

**Required remediation:** persist provider identities at acceptance and reconcile them to burn hashes before attestation processing. Report an uncertain/pending operation with a durable transfer ID. Do not blindly reburn. Same-operation PIN replay already provides deduplication; a raw duplicate-POST double-burn was not established and is not a finding.

The mainnet flag is currently enabled in source. The withdrawal route's comment that execution only reaches this path on testnet is stale. Runtime availability also depends on configured routes and relayer gas.

### C1. Commit reload recovery can discard a still-live financial request identity

**Sources:** [`CommitClient.tsx:106`](../../src/app/commit/[merchantAddress]/CommitClient.tsx#L106), [`CommitClient.tsx:150`](../../src/app/commit/[merchantAddress]/CommitClient.tsx#L150), [`CommitClient.tsx:178`](../../src/app/commit/[merchantAddress]/CommitClient.tsx#L178).

Intent lookups return `null` for network, HTTP or JSON errors. Reload recovery treats this like an authoritative absence and clears the stored durable request ID. Submission is also available while reload recovery runs. An already accepted commit can therefore be followed by a newly identified commit instead of reconciliation of the original operation.

**Evidence:** traced the actual failure-to-null and null-to-clear branches and the independently enabled submit path. Current idempotency source tests target dashboard code and do not exercise this standalone client failure path. This finding is source-proven; no live duplicate debit was attempted.

**Required remediation:** distinguish unknown, absent and terminal outcomes; keep the original ID while state is unknown; gate submission during recovery; scope stored identities to wallet and merchant. Behavioral tests must cover reload plus HTTP failure/malformed JSON and later recovery of the original accepted transaction.

## 3. Confirmed MEDIUM findings

| ID | Evidence and impact | Required correction and regression |
| --- | --- | --- |
| S4 | Both catalog PATCH routes guard with `body.active === true` but write `!!body.active`. Runtime execution of merchant PATCH with `active: "true"` returned 200 at a mocked active count of 999 without lock/count; a consumed targeted plan was also reactivated. See [`merchant/plans:250`](../../src/app/api/merchant/plans/route.ts#L250), [`v1/plans:244`](../../src/app/api/v1/plans/route.ts#L244). | Reject supplied nonboolean `active`. Cover string/number/null inputs on both HTTP surfaces, full catalog and consumed/expired targeted offers, and concurrent deactivate/reactivate versus description-only PATCH. |
| P3 | In COMPLETED payment replay, `if (existingReceipt) return` exits the entire `after()` callback before the durable verification worker. A receipt normally already exists after atomic settlement. Runtime callback proof: webhook ran once; worker ran zero times. See [`verify:236`](../../src/app/api/payment-links/verify/route.ts#L236), [`verify:295`](../../src/app/api/payment-links/verify/route.ts#L295). | Only conditionally repair missing receipts; always drain unfinished durable effects. Cover an existing receipt with unfinished DM/email/webhook effects after a settlement crash. |
| C2 | Balance preflight runs before existing-intent lookup. A confirmed debit followed by retry with low remaining balance can return 422 before returning/reconciling the original outcome. See [`vault/commit:121`](../../src/app/api/user/vault/commit/route.ts#L121), [`vault/commit:151`](../../src/app/api/user/vault/commit/route.ts#L151). | Authenticate/bind the original request, then reconcile it before new-funds preflight. Test same-ID retry after a successful debit exhausts the available wallet balance. |
| C3 | Manual vault intent creation omits environment, while schema defaults to TEST. The admin query mixes environments and historical records cannot safely be reclassified by assumption. See [`vault/commit:139`](../../src/app/api/user/vault/commit/route.ts#L139), [`schema:935`](../../prisma/schema.prisma#L935), [`telemetry:65`](../../src/app/api/admin/system/commit-latency/route.ts#L65). | Persist the actual configured environment, scope observations to it, and repair historical provenance only with chain evidence. Test mainnet/testnet creation and query isolation. |
| C4 | The route budget is 120 seconds, while first commit may wait for approval and commit sequentially; each custody confirmation permits 110 seconds, with a possible additional hash wait. GET only reads intents; there is no independent commit-intent reconciler. See [`vault/commit:25`](../../src/app/api/user/vault/commit/route.ts#L25), [`vault/onchain:268`](../../src/lib/vault/onchain.ts#L268), [`custody:247`](../../src/lib/custody.ts#L247). | Measure and bound the whole operation, persist accepted identities before waiting, and independently reconcile accepted operations after request termination. Do not shorten timeouts by assuming unconfirmed funds failed. Test process death during approval, accepted commit, hash discovery and mirror update. |
| O1 | Admin telemetry reports missing/failed intent samples as optimal, calls a block-number read “write latency,” labels a read-only DB transaction envelope “commit latency,” and displays fixed phase numbers. See [`telemetry:79`](../../src/app/api/admin/system/commit-latency/route.ts#L79), [`telemetry:108`](../../src/app/api/admin/system/commit-latency/route.ts#L108), [`UI:368`](../../src/components/admin/AdminCommitLatencyView.tsx#L368). | Unknown/error must remain distinct from healthy; label readiness probes honestly; remove fabricated stages until measured. Specify percentile convention and sample age/environment/coverage. Add route/UI tests for query outage, empty samples, invalid timestamps, stale data and overlapping polls. |

### Telemetry interpretation details

- Current p50 returns the upper middle; current p95 uses zero-based `floor(n * .95)`. For `100, 200, …, 10000 ms`, output is p50 `5100` and p95 `9600`; linear median is `5050`, nearest-rank p95 `9500`. The convention must be explicit rather than calling this a measured finality distribution without qualification.
- `createdAt → updatedAt` omits pre-intent authentication/KYC/PIN/balance work and post-intent mirror/event/response work, and can be extended by retries/errors. It is not full request-to-finality latency.
- Current SUBMITTED writers run after Circle confirmation. They represent confirmed but not yet mirrored state in these paths; do not relabel them as mere provider acceptance.
- Latest 50 intents are a bounded sample, not a global pending count. External-wallet direct commits do not create these intents. The UI's confirmation/sample denominator is not a reliable success-rate metric.
- The UI's `~35ms`, `~320ms`, `~850ms`, `~50ms` stages are constants. Its 800 ms polling text also disagrees with the 500 ms custody default.
- Actual vault reads use a primary-only provider while telemetry can fall back. Healthy telemetry on a secondary does not prove the actual balance/allowance/mirror path is healthy.

## 4. Existing worktree changes reviewed

- Removing the renewal custody prohibition is directionally correct: due `executePayment` is permissionless and needs the keeper's signer, not subscriber key custody. No production subscription exists for a live renewal check.
- Public-plan reactivation locking covers the ordinary boolean path, but S4 bypasses it. Description-only updates must also avoid resurrecting stale active state under concurrent edits.
- External-wallet period-end handling correctly retains pending revocation when entitlement expires. Its custody lookup ignores database errors, however; unavailable custody data must not be reported as a successful cancellation decision.
- External-wallet cancellation UI currently displays the route's 409 rather than initiating the returned wallet revocation requirement. Resume/change/upgrade remain custody-dependent. These are source-verified product/recovery gaps requiring explicit external-wallet acceptance coverage.
- The admin telemetry menu is wired, but O1 means the draft feature does not currently prove commit latency and must not be used for mainnet sign-off.

## 5. Live state and measured evidence

Read-only project: `jntqgoneegykgtiyvvge` (SubScript Mainnet), active/healthy PostgreSQL 17.6. Local public configuration selects chain `5042`, PSA `0xdb69519b777dA81E59dCa75B9095E832A639B1eF` and vault `0xB38Dd5af7d134454F911b4be024c0ccaaE3cA4D3`.

| Observation | Result |
| --- | --- |
| Subscription mirror | Zero rows |
| Configured PSA `nextSubscriptionId()` | `1` |
| Billing claims / payment verification jobs | Zero rows |
| Receipt recovery | Seven mainnet jobs, all `enqueued`, maximum one attempt |
| Vault intent observations | One TEST/PENDING row from 17 September; no completed LIVE samples |
| Mainnet financial commit p50/p95 | **Unmeasured** |

Latest readiness probe at `2026-10-16T09:31:03.140Z`, from the local workstation:

| Readiness measurement | Observations |
| --- | --- |
| DB `SELECT 1` round trips | 1313.8 ms cold; 219.8 and 208.7 ms warm |
| Read-only `BEGIN → SELECT 1 → COMMIT` round trips | 607.4, 673.8 and 485.0 ms |
| RPC block-number read | 830.8 ms, block `26241216` |
| Contract code/counter reads | 588.2 / 220.6 ms |

These include workstation/network/driver effects. They do not measure isolated WAL durability, custody signing or a financial transaction's inclusion/finality, and are not production-application-region SLA measurements.

The deployed PSA has code, runtime hash `0x70befebc0cf4d2406ee3f9afa245e32f5a527e73f4648426f898fa55ce2b45ca`. Its executable bytes differ from the current local artifact even after metadata/immutable normalization. Exact deployed-source parity therefore remains unresolved. Contract reproductions prove current-source behavior; they are not a claim that deployed runtime parity or live exploitation was verified.

## 6. Verification and reproduction evidence

| Command / evidence | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npx tsx --test "src/lib/subscriptions/__tests__/*.test.mjs" "src/lib/payments/__tests__/*.test.mjs" "src/lib/admin/__tests__/commit-latency.test.mjs"` | 176 passed |
| `npm run test:security` | 762 passed across 10 suites |
| `npm run test:contracts -- --network hardhat` | 88 passed |
| `npm run lint` | Zero errors, 180 warnings |
| `npm run security:secrets` after test-fixture cleanup | Passed; no credential values printed |
| Subscription lane focused existing tests | 42 passed; missing invariants still reproduced |
| Payment lane focused existing tests | 52 passed; reproduced policy/recovery gaps are not covered |
| Commit lane focused existing tests | 20 passed; some preserve misleading metric semantics |

These sets overlap; do not sum them as a unique test count. The secret gate was rerun after the security suite because the suite intentionally creates and then deletes a detector probe file.

Local, ignored audit evidence is under `.omx/audits/merchant-payment-commit/`:

- `measure-readiness.cjs` / `readiness.json`: three read/transaction probes, RPC reads and deployment fingerprint. No signing or financial write methods.
- `reproduce-contract-and-metrics.cjs` / `reproductions.json`: isolated Hardhat bridge overcharge, immutable first-due-date renewal, unknown-health and percentile behavior. The script asserts the in-memory network before any transaction.
- Lead logs: `.omx/merchant-payment-audit-{baseline,security,contracts,typecheck,lint,secrets}.log`.

Run the reproduction from the repository root with `node .omx/audits/merchant-payment-commit/reproduce-contract-and-metrics.cjs`. Its success means the **defects reproduced**, not that the application is safe. Route/healer VM experiments used current TypeScript source and mocked all financial/network boundaries; their triggers and observed outcomes are recorded above.

## 7. Remediation and release gates

1. Fix and behaviorally test S1/S2/S3 together so authorization cadence, paid entitlement and reconciliation agree. Verify deployed contract lineage before selecting a migration/deferred-authorization design.
2. Close P1 at the shared financial-policy boundary and test all callable USER transfer paths, including peer checkout.
3. Give accepted CCTP operations durable provider identities and a tested recovery worker before claiming timeout safety.
4. Preserve unresolved commit identities across reloads and reconcile existing operations before balance preflight; test request termination at every custody/mirror boundary.
5. Fix catalog input/concurrency checks and replay effect draining; add runtime tests rather than only source-pattern checks.
6. Replace unsupported admin latency claims with real stage measurements and honest unknown/error states. Persist environment correctly and obtain representative, safely authorized end-to-end samples before publishing finality p95.

No live subscription, transfer, commit, cancellation, email, migration or deployment was performed during this audit. Existing high-severity findings are open; this report completes the requested audit, not their remediation.
