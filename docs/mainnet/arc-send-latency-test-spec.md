# Arc Outgoing Send Test & Verification Specification

**Companion Specification to:** [`docs/mainnet/ARC_OUTGOING_SEND_PLAN.md`](ARC_OUTGOING_SEND_PLAN.md)  
**Date:** 2026-10-01 (Africa/Lagos)  
**Scope:** 41 Behavioral Test Cases, 10 Crash Recovery Boundaries, and End-to-End Verification Matrix  

---

## 1. 10 Crash Recovery Boundaries

These crash boundaries verify system resilience against process termination, network partitions, and provider timeouts.

| Boundary ID | Injection Point & Failure Scenario | In-Memory vs DB State at Crash | Worker Recovery Sequence | Post-Recovery Invariants |
|---|---|---|---|---|
| **CRASH-01** | Process dies immediately after DB operation commit, before calling Circle API. | Operation committed in DB as `PREPARED`. Zero external provider calls made. | Worker claims operation via `SKIP LOCKED`, transitions state to `SUBMISSION_STARTED`, and invokes Circle `createContractExecutionTransaction`. | Single reservation held; zero duplicate submissions; proceeds to normal lifecycle. |
| **CRASH-02** | Process dies during Circle API call (HTTP POST dispatched, socket severed before receiving response). | DB state is `SUBMISSION_STARTED`. In-memory response lost. External outcome unknown. | Worker queries Circle transactions list using immutable `request_key`. If Circle recognized the key, adopts `circleTxId`; if unknown, enters `SUBMISSION_UNKNOWN`. | Reservation NOT released; no blind retry with new key; prevents duplicate transfers on delayed provider processing. |
| **CRASH-03** | Process dies after Circle returns accepted transaction ID, before DB updates with `circleTxId`. | DB state remains `SUBMISSION_STARTED`. Circle has queued the transaction. | Worker queries Circle using idempotent `request_key`, discovers the existing transaction ID, persists it, and sets state to `SUBMITTED`. | State repaired transparently; exact provider ID linked; zero duplicate transfers. |
| **CRASH-04** | Process dies after DB updates to `SUBMITTED`, while waiting for block inclusion. | DB has `circleTxId` and state `SUBMITTED`. Transaction is in mempool / bundler queue. | Worker resumes status polling via `getTransaction` and listens for Circle v2 webhooks. | Monotonic progress; transitions to `CONFIRMED` upon on-chain mining. |
| **CRASH-05** | Process dies between on-chain block mining and DB finalization. | On-chain transfer is mined; DB item state is still `SUBMITTED`. | Worker or status probe queries on-chain receipt, executes `triStateVerifier`, confirms positive `Transfer` log, marks item `FINALIZED`, and updates spending limits. | Exact transfer verified; reservation transitioned to finalized; history and receipts generated. |
| **CRASH-06** | Process dies during partial batch execution (Item 1 confirmed, Item 2 dies during submission). | Item 1 is `FINALIZED`. Item 2 is `SUBMISSION_STARTED`. Item 3 is `PREPARED`. | Worker inspects Item 2. If Item 2 is unknown, sets operation to `STOPPED` (provisional). Item 1 remains finalized; Item 2 stays held; Item 3 tail is never submitted and released once. | Settled prefix frozen; unsubmitted tail protected; no accidental subsequent submissions. |
| **CRASH-07** | Process dies during single-fee recovery submission after batch completion. | All primary items are `FINALIZED`. Fee recovery record in `arc_network_fee_recoveries` is `PENDING` or in-flight. | Fee recovery worker claims the single fee recovery task via idempotent key (`operationId:gasfee`) and submits/reconciles fee transfer to treasury. | Fee charged exactly once within consented ceiling; never exceeds disclosed fee. |
| **CRASH-08** | Process dies during post-settlement side-effects (DM logging or transactional email dispatch). | Primary financial items and fees are finalized in DB. Side-effect jobs remain in queue. | Asynchronous job runner picks up pending email/DM tasks keyed by `settlementRef=operationId:itemId`. | Zero impact on financial settlement; notifications dispatched with idempotent deduplication. |
| **CRASH-09** | User browser crashes or tab is closed during browser wallet signature prompt. | Server logged intent in `CHECKING`. No transaction broadcast on-chain. | When user returns or timeout expires, if no hash is attached and no on-chain nonce movement occurred, intent is marked `CANCELLED` and reservation released. | No funds locked permanently; unsubmitted intent safely discarded. |
| **CRASH-10** | Continuous worker process crashes and restarts while holding active operation leases. | DB rows have `claim_token` and `lease_expiry = NOW() + 10s`. | Replacement worker ignores expired leases (`WHERE lease_expiry < NOW()`), increments `claim_generation`, and safely assumes execution ownership. | Zero worker deadlocks; dual-execution strictly prevented by fenced generation tokens. |

---

## 2. 41 Behavioral Test Cases

### Area A: Idempotency, Request Keys, and Terms (Cases 1–7)
- **TC-01: Exact Duplicate Request Replay**
  - *Preconditions:* Operation `op_1` already created with `request_key = "req_abc"`.
  - *Action:* Client submits identical POST `/api/user/wallet/send/operations` with `request_key = "req_abc"`.
  - *Expected:* HTTP 200/202 returned with existing `operationId`; zero new DB rows; zero duplicate Circle calls; zero double-reservation.
- **TC-02: Conflicting Terms with Same Key**
  - *Preconditions:* Operation `op_1` exists with `request_key = "req_abc"` and amount `10.0 USDC`.
  - *Action:* Client submits POST with `request_key = "req_abc"` and amount `15.0 USDC`.
  - *Expected:* HTTP 409 Conflict returned; existing operation untouched; error clearly states key conflict.
- **TC-03: Pre-v2 Legacy Request Key Replay**
  - *Preconditions:* A legacy send was accepted prior to v2 rollout.
  - *Action:* Client submits send request with the same legacy key.
  - *Expected:* Replays known settled outcome or returns explicit in-progress status; never initiates a second on-chain transfer.
- **TC-04: Unmapped Legacy Key Isolation**
  - *Preconditions:* Unmapped legacy key without stored outcome.
  - *Action:* Submitted to v2 async endpoint.
  - *Expected:* Fails closed with diagnostic error requiring manual verification; excluded from automated async cohort.
- **TC-05: Lost Response Recovery via GET**
  - *Preconditions:* POST `/operations` succeeded on server, but client disconnected before receiving HTTP 202.
  - *Action:* Client queries `GET /api/user/wallet/send/operations?requestKey=req_abc`.
  - *Expected:* Returns HTTP 200 with full operation state, active revision, and status URL.
- **TC-06: Strict 6-Decimal Micro-USDC Precision**
  - *Preconditions:* Send initiated for `1.000001 USDC`.
  - *Action:* Trace data through DB, custody calldata, and balance reservation.
  - *Expected:* Value represented strictly as `1_000_001n` (`BigInt`); zero floating-point math; exact on-chain transfer of `1000001` units.
- **TC-07: 18-Decimal Native Gas Representation**
  - *Preconditions:* Gas quote calculated on Arc.
  - *Action:* Gas estimation converted to micro-USDC for display and ceiling.
  - *Expected:* Native gas stored in 18 decimals; converted using ceiling integer division (`ceil(wei / 1e12)`); fee never under-reserved.

### Area B: Spending Limits, Delegations, and Reservations (Cases 8–14)
- **TC-08: Atomic Reservation Commit**
  - *Preconditions:* Sender has daily limit of `100 USDC`; current spend `80 USDC`.
  - *Action:* Send `15 USDC`.
  - *Expected:* Reservation of `15 USDC` commits inside the initial DB transaction; new available limit is `5 USDC` before Circle call.
- **TC-09: Rollback on Preparation Failure**
  - *Preconditions:* Sanctions check or database write fails during operation preparation.
  - *Action:* Attempt send.
  - *Expected:* DB transaction rolls back; spending reservation is completely wiped; available balance/limit restored immediately.
- **TC-10: Persistent Liability Beyond 15 Minutes**
  - *Preconditions:* Operation in `SUBMISSION_STARTED` or `SUBMISSION_UNKNOWN` remains unresolved for 20 minutes.
  - *Action:* Query spending limit status.
  - *Expected:* Operation's reservation is still counted against the daily limit; 15-minute legacy timeout does NOT release unresolved active operations.
- **TC-11: Partial Batch Reservation Retention**
  - *Preconditions:* Batch of 3 items (`10 USDC` each). Item 1 confirms; Item 2 in-flight; Item 3 queued.
  - *Action:* Evaluate total reserved/finalized amounts.
  - *Expected:* `10 USDC` is finalized; `20 USDC` remains reserved; total locked = `30 USDC`.
- **TC-12: Item-Level Share Release on Failure**
  - *Preconditions:* Batch of 2 items (`10 USDC` each). Item 1 confirms; Item 2 reverts on-chain.
  - *Action:* Reconcile Item 2 failure.
  - *Expected:* Item 2 status set to `FAILED`; exactly `10 USDC` reservation is released; Item 1 remains `FINALIZED`.
- **TC-13: Delegated Authority Credit Return**
  - *Preconditions:* User executes send via root commit delegation.
  - *Action:* Unsubmitted tail item cancelled.
  - *Expected:* Delegation spent balance is credited back exactly once for the unsubmitted item; finalized items remain consumed.
- **TC-14: Concurrency Serialization via Outflow Guard**
  - *Preconditions:* Two concurrent requests hit the API for the same funding wallet at the exact same millisecond.
  - *Action:* Both invoke `outgoingSendGuard.ts`.
  - *Expected:* One acquires Postgres advisory lock and commits; second waits and evaluates updated balance/liability before proceeding.

### Area C: Outflow Guard & Mixed-Version Concurrency (Cases 15–20)
- **TC-15: Legacy Send Blocked by In-Flight V2 Liability**
  - *Preconditions:* V2 send is currently in `SUBMITTED` state with pending reservation.
  - *Action:* User attempts legacy send via `/api/user/wallet/send`.
  - *Expected:* Outflow guard rejects legacy send if available balance minus pending liability is insufficient.
- **TC-16: Vault Commit Blocked by In-Flight V2 Liability**
  - *Preconditions:* Wallet has `10 USDC` raw balance and an active `8 USDC` pending send operation.
  - *Action:* User attempts a `5 USDC` vault commit via `/api/user/vault/commit`.
  - *Expected:* Blocked with HTTP 422 `INSUFFICIENT_AVAILABLE_BALANCE` (available is `2 USDC`).
- **TC-17: CCTP Withdrawal Blocked by In-Flight V2 Liability**
  - *Preconditions:* Pending v2 send reservation active.
  - *Action:* User triggers `/api/user/cctp/withdraw`.
  - *Expected:* Guard evaluates combined principal + fee liability; rejects withdrawal if balance would be overdrawn.
- **TC-18: Execute-Tx Transfer Blocked by In-Flight V2 Liability**
  - *Preconditions:* Pending v2 send reservation active.
  - *Action:* Direct `/api/execute-tx` call with `transferUsdc`.
  - *Expected:* Guard prevents execution; ensures legacy execute-tx callers cannot bypass reservations.
- **TC-19: Outflow Guard Rejects Client Bypass**
  - *Preconditions:* Request includes header `x-bypass-outflow-guard: true`.
  - *Action:* Send request processed by guard.
  - *Expected:* Header ignored; bypass strictly permitted only for authenticated internal recovery contexts.
- **TC-20: Read-Only Actions Unblocked During Active Sends**
  - *Preconditions:* Wallet has active in-flight send operations.
  - *Action:* User queries balances, transaction history, and DM messages.
  - *Expected:* All read queries succeed without blocking; available balance correctly reflects net pending deductions.

### Area D: Tri-State On-Chain Verifier & Inner-Call Reverts (Cases 21–27)
- **TC-21: Positive Log Verification**
  - *Preconditions:* Transaction mined on Arc.
  - *Action:* `triStateVerifier` inspects receipt.
  - *Expected:* Verifies `Transfer(address,address,uint256)` event: matching token address, sender, recipient, and amount. Returns `CONFIRMED`.
- **TC-22: ERC-4337 Inner Revert Detection**
  - *Preconditions:* Outer transaction status is `1` (success), but Circle SCA execution reverted internally (`UserOperationEvent.success == false`).
  - *Action:* `triStateVerifier` evaluates receipt.
  - *Expected:* Returns `PROVEN_FAILED`; does NOT mark item as confirmed.
- **TC-23: Transient RPC Timeout Handling**
  - *Preconditions:* Arc RPC returns HTTP 504 / timeout during receipt fetch.
  - *Action:* Verifier processes error.
  - *Expected:* Returns `UNRESOLVED`; reservation remains held; worker reschedules check.
- **TC-24: Single Log Claiming**
  - *Preconditions:* Multi-transfer transaction containing multiple logs.
  - *Action:* Item claims `log_index = 2`.
  - *Expected:* `uq_outgoing_receipt_transfer` prevents any other item from claiming `log_index = 2`.
- **TC-25: Arc Native Precompile & ERC-20 Support**
  - *Preconditions:* Transfer executed on Arc native USDC.
  - *Action:* Log parsed for both precompile address and standard ERC-20 contract.
  - *Expected:* Normalized correctly without duplicate balance crediting.
- **TC-26: Trusted EntryPoint Validation**
  - *Preconditions:* Malicious contract emits a fake `Transfer` log with matching parameters.
  - *Action:* Verifier evaluates log origin.
  - *Expected:* Verifies that caller was the trusted Arc ERC-4337 EntryPoint; rejects spoofed events.
- **TC-27: Circle STUCK State Handling**
  - *Preconditions:* Circle API returns status `STUCK`.
  - *Action:* Worker reconciles status.
  - *Expected:* Treated as non-terminal `UNRESOLVED`; does not throw; does not trigger blind retry; alerts operator.

### Area E: Circle v2 Webhooks, Worker & Polling Reconciliation (Cases 28–34)
- **TC-28: Valid ECDSA Webhook Verification**
  - *Preconditions:* Inbound webhook from Circle with valid `X-Circle-Key-Id` and `X-Circle-Signature`.
  - *Action:* Webhook endpoint verifies signature against cached public key.
  - *Expected:* Signature verifies cleanly; event processed; HTTP 200 returned.
- **TC-29: Forged Webhook Signature Rejection**
  - *Preconditions:* Attacker submits forged webhook payload or invalid signature.
  - *Action:* Webhook endpoint verifies signature.
  - *Expected:* HTTP 401 Unauthorized; payload dropped immediately; zero state changes.
- **TC-30: Monotonic Out-of-Order Webhook Resolution**
  - *Preconditions:* `COMPLETE` event arrives before `SENT` event.
  - *Action:* Webhook handler processes both events.
  - *Expected:* State moves to `CONFIRMED` / `COMPLETE`; late-arriving `SENT` event cannot downgrade status.
- **TC-31: Duplicate Webhook Idempotency**
  - *Preconditions:* Circle redelivers the same webhook notification 3 times.
  - *Action:* Handler processes notifications.
  - *Expected:* First execution updates DB; subsequent deliveries deduped by notification ID; returns HTTP 200 without duplicate work.
- **TC-32: Unmatched Webhook Buffer**
  - *Preconditions:* Webhook arrives before the API route finishes committing `circleTxId`.
  - *Action:* Webhook handler cannot find matching DB item immediately.
  - *Expected:* Event saved in `unmatched_webhook_events`; worker correlates event once DB transaction commits.
- **TC-33: Worker Concurrency & Fenced Leases**
  - *Preconditions:* 2 worker processes running concurrently.
  - *Action:* Both poll due queue.
  - *Expected:* `SKIP LOCKED` ensures each claims distinct operations; lease renewals increment generation token.
- **TC-34: Worker Graceful Shutdown**
  - *Preconditions:* Worker receives `SIGTERM` while reconciling an operation.
  - *Action:* Process termination initiated.
  - *Expected:* In-flight DB commit finishes; lease released; worker exits cleanly within 3 seconds.

### Area F: Fees, Side Effects, Receipts, and Browser Wallets (Cases 35–41)
- **TC-35: Fee Recovery Deferred Until All Items Terminal**
  - *Preconditions:* Batch of 3 items. Items 1 and 2 confirmed; Item 3 in-flight.
  - *Action:* Fee engine evaluates fee recovery.
  - *Expected:* Fee recovery NOT scheduled yet; waits until Item 3 reaches terminal status.
- **TC-36: Provisional Stop Freezes Fee Recovery**
  - *Preconditions:* Batch stopped with 1 item in `SUBMISSION_UNKNOWN`.
  - *Action:* Fee engine evaluates fee recovery.
  - *Expected:* Fee recovery suspended; fee reserve retained; fee charged only after unknown item is adjudicated.
- **TC-37: Zero-Settled Batch Zero Fee**
  - *Preconditions:* All items in a batch fail before execution.
  - *Action:* Fee engine calculates fee.
  - *Expected:* Total settled amount is 0; fee recovery cancelled completely; zero fee charged.
- **TC-38: Domain-Separated Outgoing Receipt ID**
  - *Preconditions:* 5 items in a batch share the same outer ERC-4337 transaction hash.
  - *Action:* Receipts generated for all items.
  - *Expected:* Each item receives unique `rcpt_out_<uuid>`; receipts do not overwrite each other; each links to exact recipient and amount.
- **TC-39: Idempotent Email Dispatch**
  - *Preconditions:* Receipt email worker triggered twice for same item.
  - *Action:* Dispatches email with key `settlementRef=op1:item1`.
  - *Expected:* Exactly one email sent to sender; duplicate job discarded.
- **TC-40: Browser Wallet User Rejection**
  - *Preconditions:* Browser wallet prompts user; user clicks "Reject".
  - *Action:* `useOutgoingSends` catches rejection.
  - *Expected:* Transient intent marked `CANCELLED`; reservation released; UI returns to editing state.
- **TC-41: Browser Wallet Replacement & Cancellation**
  - *Preconditions:* User sends transaction with nonce 42, then submits "Speed up" or "Cancel" in MetaMask with nonce 42.
  - *Action:* Worker monitors on-chain nonce 42.
  - *Expected:* If replacement transfer confirms, binds new hash; if cancellation confirms (0 ETH to self), marks original send `FAILED` and releases reservation.

---

## 3. Verification Methodologies & Test Harness

### 3.1 Unit & Sandboxed VM Tests
- **Harness:** `node:test` + isolated VM execution contexts.
- **Focus:** Preflight parallelization, quote math, precision edge cases, and deterministic error code mappings.
- **Command:** `npm test -- src/lib/payments/__tests__/sendQuote-rpc.test.mjs`

### 3.2 Real Disposable PostgreSQL Concurrency Tests
- **Harness:** Ephemeral local PostgreSQL instance (Docker / Supabase Local).
- **Focus:** Advisory locks, `SKIP LOCKED` worker queues, simultaneous duplicate submissions, and spending limit retention past 15 minutes.
- **Verification Rule:** Never run financial concurrency tests against mocks; row locking semantics must be validated against real PostgreSQL.

### 3.3 End-to-End Timing & UI Verification (Playwright)
- **Harness:** Playwright browser tests (`tests/send-flow.spec.ts`).
- **Focus:** Modal open-to-close latency, sub-100ms optimistic row presentation, zero artificial animation delays, and background polling termination.

### 3.4 Testnet Canary Drills
- **Harness:** Dedicated canary accounts executing real transfers on Arc Testnet (Chain ID: `5042002`).
- **Drills:**
  1. Process kill during submission (`kill -9` worker).
  2. Severed network connection during Circle POST.
  3. Replaced transaction on MetaMask.
  4. Complete send cycle with closed browser tab.
