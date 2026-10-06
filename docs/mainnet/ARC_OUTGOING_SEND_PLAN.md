# Arc Outgoing Send Implementation Plan

**Date:** 2026-10-01 (Africa/Lagos)  
**Deliverable:** Master Architecture & Engineering Implementation Plan  
**Target:** SubScript Arc Mainnet (Chain ID: `5042`) and Arc Testnet (Chain ID: `5042002`)  
**Scope:** Embedded (Circle MPC SCA) and Browser Wallets (EIP-1193), Single and Batch Sends, Desktop Dialog & Mobile Fluid Sheet  

---

## 1. Executive Summary & Architectural Decisions

### 1.1 Objective
Make outgoing Arc sends appear on the SubScript platform immediately (<100ms UI acknowledgment) and expose verified results without waiting on background history indexing, animations, transactional emails, or secondary fee-recovery transactions. Simultaneously, maintain absolute accounting integrity: accurate item status, full recipient amounts, validated spending limits, user fee consent, and robust crash recovery.

### 1.2 Core Architectural Decisions
1. **Separation of Presentation from Settlement:** Instant presentation (<100ms) is decoupled from blockchain finality. The UI immediately reflects `"PREPARING"` or `"QUEUED / SUBMITTED"`, while the database and background reconciliation worker asynchronously track Arc block mining and Circle transaction state transitions.
2. **Preserve Custody Contract Guarantees:** The existing `executeContract()` synchronous settlement guarantee in `src/lib/custody/index.ts` is strictly preserved for its 32 existing callers. New asynchronous capabilities are exposed via additive methods (`submitContractExecution` and `getExecutionStatus`).
3. **Durable Identity Before Submission:** Every send operation and batch item receives an immutable UUID, caller fingerprint, and request key in PostgreSQL *before* contacting Circle or broadcasting to the network. Session/local storage is treated strictly as an ephemeral display cache, never the authoritative financial ledger.
4. **Conservative Handling of Uncertainty:** "Unknown is not Failed; Pending is not Sent." If an RPC call, network request, or worker process times out while an item is in-flight, its principal reservation remains held, the operation enters `SUBMISSION_UNKNOWN` / `NEEDS_REVIEW`, and no automatic duplicate retry is ever dispatched with a new key.
5. **Shared Outflow Guard:** A centralized `outgoingSendGuard.ts` advisory lock and active-liability check covers both legacy and v2 endpoints (including direct sends, batch payouts, vault commits, top-ups, and CCTP withdrawals). A funding wallet cannot spend funds through an older endpoint while unresolved send liabilities exist.
6. **Unified Fee Recovery Sequencing:** Platform fee recovery from the sender wallet (`gasPayer: "wallet"`) is deferred until all primary items in a batch reach a proven terminal state (`CONFIRMED`, `FAILED`, or `STOPPED`). Fee recovery is frozen once from the sum of settled items and never exceeds the user-consented ceiling.

---

## 2. Current Baseline & Codebase Anchors

The implementation directly integrates with and builds upon the inspected baseline:

| Subsystem Anchor | Current Codebase Baseline & Consequence |
|---|---|
| `src/app/api/user/wallet/send/route.ts` | Legacy synchronous flow. Release 1 parallelized preflight checks (`Promise.all`) and added granular latency instrumentation (`[WalletSendTiming]`). Serves as the fallback route for legacy clients. |
| `src/lib/custody/index.ts` | `CircleCustody.executeContract` waits for `CONFIRMED` / `COMPLETE` with an 800ms adaptive polling loop. Additive methods `submitContractExecution()` and `getExecutionStatus()` decouple submission from reconciliation. |
| `src/app/dashboard/user/page.tsx` | Available balance reserves pending optimistic transactions (`walletBalance = Math.max(0, rawWalletBalance - pendingReservedUsdc)`). Balance and inbox polling runs at 5-second intervals. |
| `src/components/SendSingleModal.tsx` | Fluid mobile bottom sheet and desktop modal. Artificial animation delays (`wait(650)` and `wait(430)`) removed in Release 1; triggers immediate background balance/history refresh upon confirmed result. |
| `src/lib/optimisticTx.ts` | Ephemeral `sessionStorage` tracker with 5-minute expiry. Used strictly for sub-100ms client presentation; reconciled by durable server operation state. |
| `src/lib/spendingLimits.ts` & `src/lib/commitId.ts` | Postgres advisory locks (`pg_advisory_xact_lock`) and cumulative daily limits. Extended to hold reservations across process lifetimes without arbitrary 15-minute expiration for active operations. |
| `src/lib/vault/onchain.ts` | Contains `embeddedTransferReverted()`. Updated to provide positive tri-state log verification rather than negative revert absence. |
| `src/app/api/webhooks/route.ts` & `src/lib/webhooks/` | Handles inbound webhooks. Upgraded to support Circle Wallets v2 ECDSA signatures via `X-Circle-Key-Id`. |
| `scripts/arc-send-worker.mjs` | New dedicated 1-second continuous Node/PostgreSQL background supervisor for polling and reconciling due outgoing operations. |

---

## 3. Strict System Invariants

1. **Authorization Precedes Parallelization:** Sender identity, role, parent funding wallet, chain ID, token, custody mode, and delegated authority must be resolved before any concurrent read or write is initiated. Holds, halts, and sanctions blocks are checked before any unsent item moves.
2. **No Blind Retries:** A hash, webhook, local timeout, missing receipt, SDK exception, or Circle `STUCK` state cannot decide failure. Ambiguous operations remain reserved and visible; they are never resent automatically with a fresh request key.
3. **Atomic Reserve-Before-Submit:** One durable operation maintains one principal reservation, one delegated reservation (where applicable), and one fee policy. Reservations commit inside a caller-owned DB transaction before the external provider call.
4. **Idempotent Replay & Conflict Rejection:** The same logical operation key with identical immutable terms returns the existing operation state without duplicate reservations, submissions, fees, DMs, or receipts. The same key with altered terms returns `409 Conflict`.
5. **Preserve Recipient Value:** Circle user-to-user sends remain `gasPayer: "wallet"`, debiting the sender for network fee recovery without touching recipient principal or entering merchant sponsorship accounting.
6. **Honest UI State Mapping:** UI states strictly match verification evidence: `Preparing` (signature prompt), `Queued / Submitted` (provider accepted), `Checking` (block mined, verifying logs), `Confirmed` (positive transfer verified), `Partial` (some batch items succeeded), `Failed` (proven execution revert). `Pending` is never displayed as `Sent`.
7. **Append-Only Audit & Persistent State:** All item identities, provider transaction IDs, and audit records must commit to PostgreSQL before dependent actions (history, emails, fee recovery) are scheduled.
8. **Batch Failure Isolation & Immutable Settled Prefix:** When an item in a batch fails or enters an unknown state, the settled prefix is frozen, and submission of subsequent tail items stops immediately. Each recipient displays individual status. Retries generate new, explicitly linked attempts only for eligible tail items.
9. **Non-Destructive Feature Flag Disablement:** Disabling `ARC_SEND_ASYNC_ENABLED` halts new asynchronous enrollments; existing in-flight operations continue to be reconciled by the background worker. Database records and transfer evidence are never deleted.
10. **Shared Outflow Guard:** A single shared funding-wallet/chain lock covers legacy sends, v2 sends, vault commits, and withdrawals. Pending principal and fee reservations cannot be spent through an older endpoint.

---

## 4. Detailed Database Architecture (`format_version = 2`)

The data model extends the existing `batch_send_operations` and `batch_send_items` schema with additive fields and `format_version = 2` semantics, avoiding redundant parallel tables.

### 4.1 Send Operations Schema Extensions (`batch_send_operations`)
```sql
ALTER TABLE batch_send_operations
  ADD COLUMN IF NOT EXISTS format_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS caller_address TEXT,
  ADD COLUMN IF NOT EXISTS funding_wallet TEXT,
  ADD COLUMN IF NOT EXISTS commit_id TEXT,
  ADD COLUMN IF NOT EXISTS chain_id INTEGER,
  ADD COLUMN IF NOT EXISTS token_address TEXT,
  ADD COLUMN IF NOT EXISTS custody_mode TEXT DEFAULT 'CIRCLE_SCA', -- 'CIRCLE_SCA' | 'BROWSER_EIP1193'
  ADD COLUMN IF NOT EXISTS request_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS quoted_fee_ceiling_micros BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_estimator_version TEXT,
  ADD COLUMN IF NOT EXISTS total_principal_micros BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fee_micros BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spending_reservation_id TEXT,
  ADD COLUMN IF NOT EXISTS delegation_reservation_id TEXT,
  ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reconciliation_needed_reason TEXT,
  ADD COLUMN IF NOT EXISTS due_time TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS claim_generation BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_expiry TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS escalation_time TIMESTAMPTZ;

-- Uniqueness constraint for V2 operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_send_ops_v2_key 
  ON batch_send_operations(caller_address, chain_id, request_key) 
  WHERE format_version = 2;

-- Worker queue index
CREATE INDEX IF NOT EXISTS idx_batch_send_ops_worker_due 
  ON batch_send_operations(due_time, status) 
  WHERE status IN ('PREPARED', 'SUBMISSION_STARTED', 'SUBMITTED', 'SUBMISSION_UNKNOWN', 'NEEDS_REVIEW');
```

### 4.2 Send Items Schema Extensions (`batch_send_items`)
```sql
ALTER TABLE batch_send_items
  ADD COLUMN IF NOT EXISTS item_uuid UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS original_position INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS call_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS attempt_id UUID,
  ADD COLUMN IF NOT EXISTS provider_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_op_hash TEXT,
  ADD COLUMN IF NOT EXISTS transfer_log_index INTEGER,
  ADD COLUMN IF NOT EXISTS confirmed_block BIGINT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_amount_micros BIGINT,
  ADD COLUMN IF NOT EXISTS allocated_principal_micros BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocation_state TEXT DEFAULT 'RESERVED', -- 'RESERVED' | 'FINALIZED' | 'RELEASED'
  ADD COLUMN IF NOT EXISTS release_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_send_items_uuid 
  ON batch_send_items(item_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_send_items_provider_key 
  ON batch_send_items(operation_id, provider_key);
```

### 4.3 Outgoing Send Receipt Projection Schema
```sql
CREATE TABLE IF NOT EXISTS outgoing_send_receipts (
  receipt_id TEXT PRIMARY KEY, -- 'rcpt_out_' || gen_random_uuid()
  operation_id UUID NOT NULL REFERENCES batch_send_operations(id),
  item_id UUID NOT NULL REFERENCES batch_send_items(id),
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  payer_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  amount_micros BIGINT NOT NULL,
  network_fee_micros BIGINT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_outgoing_receipt_transfer UNIQUE(chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_outgoing_receipts_payer ON outgoing_send_receipts(payer_address);
CREATE INDEX IF NOT EXISTS idx_outgoing_receipts_recipient ON outgoing_send_receipts(recipient_address);
```

---

## 5. Phased Releases & Execution Roadmap

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        6-PHASE OUTGOING SEND RELEASE ROADMAP                           │
├───────────────────┬───────────────────┬───────────────────┬──────────────┬─────────────┤
│     Phase 1       │      Phase 2      │      Phase 3      │   Phase 4    │   Phase 5   │
│ Baseline & Immed. │ RPC / Read Perf   │ Durable Identity  │ Worker & V2  │ Async UI &  │
│ Reflection (DONE) │ Dedup & Caching   │ & Outflow Guard   │ Webhooks     │ Browser Wal.│
└───────────────────┴───────────────────┴───────────────────┴──────────────┴─────────────┘
                                  │
                                  ▼
                            ┌─────────────┐
                            │   Phase 6   │
                            │ Canary & Go │
                            └─────────────┘
```

### 5.1 Release 1: Baseline and Immediate Confirmed-Result Reflection
*Status: IMPLEMENTED & VERIFIED in Worktree*
- **Scope:**
  - Parallelized independent preflight checks in `/api/user/wallet/send/route.ts` with `Promise.all`.
  - Added microsecond latency instrumentation in `CircleCustody.executeContract` and response telemetry (`preflightMs`, `submissionMs`, `confirmationMs`, `totalMs`).
  - Implemented optimistic pending balance reservation (`walletBalance = Math.max(0, rawWalletBalance - pendingReservedUsdc)`).
  - Eliminated artificial animation waits (`wait(650)` and `wait(430)`) in `SendSingleModal.tsx`.
  - Preserved synchronous custody `executeContract()` settlement guarantees.
- **Exit Gate:** All existing test suites pass (35 payment/admin/limits tests, 61 modal/CCTP tests); confirmed results reflect in dashboard within 100ms of mining.

### 5.2 Release 2: Reduce RPC/Read Overhead Without Changing Settlement Semantics
- **Scope:**
  - Singleton `JsonRpcProvider` caching pinned by endpoint and active chain (`5042` mainnet, `5042002` testnet) with `staticNetwork: true`.
  - Deduplication of concurrent fee reads; 3-second memory cache for read-only gas estimates (`chain:provider:estimator_version`).
  - Strict exclusion of auth, hold, limit, or balance checks from caching.
  - Server-side read proxy for browser RPC requests to prevent exposing paid API keys.
  - Retain 800ms Circle polling baseline (500ms tested as isolated experiment).
- **Exit Gate:** RPC call volume reduced by >=40% during preflight; 0% increase in 429 errors; failure injection verifies chain mismatch and RPC timeouts fail closed.

### 5.3 Release 3: Durable User-Send Identity and Accounting Before Early Responses
- **Scope:**
  - Database migration applying `format_version = 2` columns to `batch_send_operations` and `batch_send_items`.
  - Atomicity of reservation and idempotency claim: `checkAndReserveSpendingLimit` and `recordSubUserSpend` unified in a single caller-owned PostgreSQL transaction.
  - Extended spending limit engine: reservations for `SUBMISSION_STARTED`, `SUBMITTED`, and `SUBMISSION_UNKNOWN` persist until proven terminal, overriding arbitrary 15-minute expiration.
  - Implementation of `src/lib/payments/outgoingSendGuard.ts`: PostgreSQL advisory locks on `(funding_wallet, chain_id)` with cross-endpoint liability enforcement across sends, vault commits, and withdrawals.
  - On-chain tri-state verifier in `src/lib/payments/triStateVerifier.ts`: verifies exact `Transfer(address,address,uint256)` event logs against trusted EntryPoint and token contracts.
  - Narrowly scoped `OutgoingSendReceipt` projection avoiding outer-hash collisions on ERC-4337 batches.
- **Exit Gate:** Disposable Postgres tests pass concurrent duplicate submissions, conflicting terms, 15+ minute liability retention, and double-release prevention.

### 5.4 Release 4: Separate Submission from Reconciliation & Continuous Worker
- **Scope:**
  - Additive custody methods: `submitContractExecution()` (returns immediately upon provider acceptance) and `getExecutionStatus()`.
  - New asynchronous endpoint: `POST /api/user/wallet/send/operations` returning HTTP `202 Accepted` with `{ operationId, revision, state: "QUEUED", statusUrl }`.
  - Continuous supervisor worker: `scripts/arc-send-worker.mjs` polling due work every 1 second via `FOR UPDATE SKIP LOCKED` with 10-second fenced leases and heartbeat telemetry.
  - Circle Wallets v2 ECDSA signature verification: validating inbound webhooks via `X-Circle-Key-Id` and official Circle public keys.
  - Deferred fee recovery: single-fee freeze enqueued only after all primary items reach terminal status (`CONFIRMED`, `FAILED`, or `STOPPED`).
- **Exit Gate:** 10 crash boundaries pass under chaos testing; worker gracefully survives process kills; dead letters alert without unlocking reserved funds.

### 5.5 Release 5: Asynchronous Pending UI, Balance Projection & Browser Wallets
- **Scope:**
  - React hook `useOutgoingSends.ts` managing client operation polling with adaptive backoff (1s -> 2s -> 5s -> 10s) and window focus awareness.
  - Block-based balance debit projection: available balance subtracts reserved principal until the confirmed transfer block is covered by the raw balance snapshot.
  - Browser wallet flow: server logs intent before prompting signature; tracks submitted hash; handles replaced/cancelled transactions via `(sender, nonce)` tracking.
  - Batch payout progress: live per-item state cards (`Item 1: Confirmed`, `Item 2: In-Flight`, `Item 3: Queued`); isolated tail retry for failed or stopped items.
- **Exit Gate:** Desktop and mobile send flows verify instant modal dismissal; pending operations survive page reload; zero instances of pending items showing "Sent".

### 5.6 Release 6: Canary Rollout, Operations Runbook & Mainnet Promotion
- **Scope:**
  - Dynamic feature flags: `ARC_SEND_ASYNC_ENABLED`, `ARC_SEND_ASYNC_ALLOWLIST`, `ARC_SEND_ASYNC_BATCH_ENABLED`.
  - Canary progression: Internal Canary -> 1% -> 10% -> 50% -> 100% with minimum 24-hour stability gates and sample sizes (>=50 sends per cohort).
  - Automated kill switches: immediate fallback to synchronous Release 1 flow upon invariant violation without interrupting worker reconciliation.
  - Sentry alerting on worker heartbeat missing (>10s) and operations unresolved (>5m).
  - Mainnet documentation and checklist maintenance in `docs/mainnet/README.md`.
- **Exit Gate:** Full 41-case behavioral test matrix passes; canary stages meet performance targets; zero accounting discrepancies observed.

---

## 6. Background Worker Architecture (`scripts/arc-send-worker.mjs`)

The background worker provides dependable, continuous reconciliation independent of browser sessions or Vercel cron intervals:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CONTINUOUS ARC SEND WORKER LOOP                      │
└────────────────────────────────────────────────────────────────────────┘
                               │ (Every 1000ms)
                               ▼
        ┌──────────────────────────────────────────────┐
        │  SELECT * FROM batch_send_operations         │
        │  WHERE status IN ('PREPARED', 'SUBMITTED',   │
        │                   'SUBMISSION_UNKNOWN')      │
        │    AND due_time <= NOW()                     │
        │  ORDER BY due_time ASC                       │
        │  FOR UPDATE SKIP LOCKED LIMIT 10             │
        └──────────────────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       [State: PREPARED]             [State: SUBMITTED]
                │                             │
    Submit item to Circle             Query Circle status /
    Commit SUBMISSION_STARTED         Inspect on-chain receipt
                │                             │
                ▼                             ▼
       Store providerTxId             Verify Transfer event
       Set state SUBMITTED            Tri-State Verifier
                │                             │
                ▼                             ▼
       Schedule next poll             Item FINALIZED / FAILED
                                      Freeze fee on batch end
```

### Worker Operational Specifications
1. **Concurrency Control:** `SELECT ... FOR UPDATE SKIP LOCKED` prevents worker competition across multiple replicas.
2. **Lease Fencing:** Leases expire after 10 seconds (`lease_expiry = NOW() + INTERVAL '10 seconds'`). Each lease renewal increments `claim_generation`. Updates fail if the generation token mismatches.
3. **Graceful Shutdown:** Intercepts `SIGTERM` / `SIGINT`; completes active in-flight database commits before exiting; releases un-executed leases.
4. **Heartbeat & Telemetry:** Updates `worker_heartbeats` table every 5 seconds; external monitoring alerts if no heartbeat is observed for >10 seconds.

---

## 7. Performance Targets & SLA Boundaries

| Metric | Legacy Baseline | Release 1 (Current) | Release 6 Target |
|---|---|---|---|
| User Interaction to Provisional UI | ~1,200ms | ~150ms | **<= 100ms (p95)** |
| API Acknowledgment (HTTP 202) | N/A (110s sync wait) | N/A (110s sync wait) | **<= 400ms (p95)** |
| Confirmed Result UI Reflection | 5,000ms – 10,000ms | Mined Block + 100ms | **<= 100ms** after revision |
| Post-Mining History Visibility | Up to 15s (polling) | Immediate local projection | **<= 2s (p95)** via worker |
| Mobile Pre/Post Animation Wait | 1,080ms total | **0ms** (Purged) | **0ms** |
| Circle API Polling Load | 800ms per active client | 800ms in API route | **Batched via Worker** |

*Note: End-to-end Arc blockchain settlement remains bounded by Arc consensus (~500ms–1,000ms) and Circle transaction batching. These targets reflect platform responsiveness, not artificial settlement acceleration.*

---

## 8. Rollback & Disaster Recovery Procedures

1. **Feature Flag Deactivation:** Set `ARC_SEND_ASYNC_ENABLED = false` in environment configuration.
   - *Result:* All client modals immediately revert to the synchronous Release 1 send route.
   - *Invariant:* The background worker remains running to reconcile all existing in-flight v2 operations to their final terminal states.
2. **Database Ledger Retention:** Never execute destructive SQL or drop version-2 columns while live operations exist. Unresolved rows remain safely locked under `outgoingSendGuard.ts` until investigated.
3. **Manual Adjudication Tooling:** Operations flagged as `NEEDS_REVIEW` expose detailed telemetry in the Admin Console (`/admin/system/outgoing-sends`), allowing administrators to inspect raw on-chain transaction receipts and manually trigger finalization or release.
