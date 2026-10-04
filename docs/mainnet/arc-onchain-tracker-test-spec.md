# Arc onchain tracker test specification

Companion to [implementation plan](./ARC_ONCHAIN_TRACKER_PLAN.md). New tests below are planned and must import production decoders/scanners/projections; do not copy their implementation into the test. No test below is claimed implemented merely because it appears here.

## Deterministic unit and component fixtures

| ID | Fixture / trigger | Required assertion |
|---|---|---|
| U1 | One Arc ERC-20 USDC send with native system 18-decimal + ERC-20 6-decimal logs | One monetary movement, exact normalized integer micros, both observations retained, correct log sender |
| U2 | Two equal same-recipient transfers in one tx, each with paired emitters | Two distinct canonical movements; neither txHash nor amount-based collapse |
| U3 | Native send, internal CALL/CREATE movement, mint, burn; gas-only balance loss | Native movements come from system logs; mint/burn classified separately; gas from receipt, no fake deposit |
| U4 | Relayed send / two UserOperations, one succeeds and one inner-reverts while outer receipt succeeds | Only verified successful operation is reported successful; trace sender is not substituted for token sender |
| U5 | 18-decimal amount with sub-micro remainder / very large value | Raw amount/precision preserved; API micros conversion documented and exact; no Number arithmetic for money |
| U6 | Same timestamp for consecutive blocks and backfill of old blocks | Canonical block/transaction/log ordering; block timestamp preserved; ingestion date is not transaction date |
| U7 | Etherscan status0, rate limit, unsupported-tier/403, partial page, missing logIndex | Explicit provider error/coverage state; no empty-success interpretation; ambiguous event matched by verified receipt or left unresolved |
| U8 | Wrong eth_chainId, wrong environment, arbitrary vault override, opposite-Arc route | Reader/scanner/worker fails closed before any projection/write or wrong-chain read |
| U9 | DNS ETIMEDOUT/EAI_AGAIN and nested errors with credential query URL | Retryable webhook status/backoff; logs and stored errors contain no query secrets or embedded auth credentials |
| U10 | DB idle-client error, disconnect during a SELECT, disconnect after a financial COMMIT | Idle error handled/client evicted; safe read bounded retry then503; committed monetary work is never blindly replayed |
| U11 | Optimistic receipt reconciled to indexed movement, principal plus fee recovery in same hash | Stable movement IDs; pending does not imply confirmed; fee recovery remains distinguishable |
| U12 | TEST events immediately before/after the pinned Zero5 activation block, plus Mainnet genesis | Correct epoch-specific NativeCoin*/system Transfer decoder, emitter and precision; unavailable old TEST ranges are explicitly incomplete, never claimed complete |

## Database and worker integration

Use an isolated local/cloned test database and mocked RPC where practical. No default integration command mutates production. Apply real forward migrations through the repository runner in the test environment; supply separate short lock/statement timeouts for migration phases.

| ID | Scenario | Required assertion |
|---|---|---|
| I1 | Crash before DB transaction, after observations but before commit, and immediately after commit | Cursor/observations are atomic; restart retries the uncommitted range; committed range is not double-projected |
| I2 | Two workers claim same stream; old lease resumes after expiry and new owner commits | Fencing rejects stale owner; one checkpoint progression and unique projection/outbox keys |
| I3 | One emitter/shard/range fails while others return logs; empty successful range | Failed/partial range does not advance coverage; verified empty range does |
| I4 | Provider range limit,429,timeout, malformed response, failover disagreement | Adaptive splitting and bounded backoff; no lost range; wrong identity/disagreement alarms |
| I5 | New platform wallet with creation-block anchor, imported wallet without anchor, wallet registered mid-backfill | Every wallet obtains correct coverage-start/status; anchorless import is incomplete until proven historical scan completes; live tail not starved |
| I6 | Mainnet/testnet records share wallet/tx-shaped IDs; CCTP source/destination state | Every query/claim/projection/link scopes environment and chain; unauthenticated/other-account access denied; raw tables inaccessible to public roles |
| I7 | CCTP delayed attestation, mint confirmed, failed source operation, duplicate message, multiple unrelated events same burn hash | One verified bridge link per message/event; unrelated movements remain visible; destination deposit only after mint; unknown mint provenance stays unknown |
| I8 | Historical backfill and duplicate live range replay across notification channels | Zero backfill alerts; one durable outbox intent per movement/recipient/channel; retry does not create new intents |
| I9 | Fresh migrations vs upgrade from deployed legacy chain CHECK | Same canonical mappings; inspected legacy rows have explicit disposition; old checksummed migrations untouched |
| I10 | Concurrent normal reads/writes during NOT VALID add, later validation and concurrent index build; interrupted build retry | Initial restrictive locks released before validation phase; transactions obey timeout; index outside transaction; invalid index detected/recovered and runner succeeds |
| I11 | Raw observations/checkpoint commit, projector crashes before/after movement/outbox commit; lease expires or job goes dead | Ingestion atomically creates discoverable projection work; fenced projection/upsert/outbox/done commit is atomic; pending work resumes; dead job alerts and blocks complete projected-coverage status |
| I12 | Wallet registered after its raw observations and generic movements already exist; decoder/projector version replay | Durable wallet-view job materializes correct owned history despite existing observation conflicts; version replay preserves canonical movement and notification identity |
| I13 | Legacy GET already notified a deposit; shadow/cutover indexes it, then rollback/re-enable occurs; one later live deposit and delayed CCTP mint arrive | Persisted wallet/environment/chain activation boundary suppresses all pre-boundary alerts; legacy producer remains off; later movement gets one outbox intent; destination mint follows its own destination boundary |

## API and browser checks

| ID | Scenario | Required assertion |
|---|---|---|
| E1 | GET /api/user/deposits, GET /api/user/cctp/scan and both page callers with RPC/Etherscan unavailable | No RPC/explorer/send/bridge/notification work from GET; existing DB history and explicit freshness still returned; scan is an authenticated ownership-scoped compatibility read or retired |
| E2 | Cursor paging across identical timestamps, same-hash multiple events, new live inserts | No duplicated/skipped movements; stable cursor based on canonical ordering |
| E3 | Empty tracked wallet, incomplete import, stalled tracker, DB outage | Distinct user-facing states; 503 where appropriate; prior rows retained on refresh failure |
| E4 | Explorer-sourced and mixed cached datasets in home history/full history/details/exports | Exact linked Powered by Etherscan.io APIs on every relevant displayed surface; RPC-only provenance is truthful |
| E5 | TEST vault in same DB as LIVE account; CCTP records crossing environments | Live dashboard and operational jobs never show/claim test data |
| E6 | Notification consumer repeated delivery, dashboard opened repeatedly during bridge pending | Opening dashboard initiates no spend/mint/sweep; notifications remain idempotent; keeper preserves pending lifecycle |
| E7 | Original router-before-init Sentry stack reproduced in its actual component | No dispatch before router readiness; role/session failure remains a truthful outage/unauthenticated state |
| E8 | Unauthenticated caller supplies a wallet address to CCTP scan; authenticated caller supplies another wallet | Unauthorized request rejected before any read of owned history or sweep/mint/spend invocation; keeper secret and stored authorized intent required for operations |

## Load, observation and rollout

| ID | Evidence to collect | Proposed gate |
|---|---|---|
| O1 | At least1000 warmed history requests,20 concurrent readers,1000 watched wallets; measure acquire/query/serialize durations separately | DB-backed history P95 <=300ms; errors classified and no connection leak |
| O2 | Live scan and simultaneous historical import with injected provider failures | P95 head-to-projection <=10s under normal provider availability; failure causes alert and does not fake progress |
| O3 | 24-hour shadow run against fixture/known receipt ground truth and independently sampled RPC receipts | Zero unexplained missing events, duplicate principal movements or amount deltas; no notification/spend side effects |
| O4 | Pause worker >60s, wrong-chain endpoint, outbox backlog, import history backlog | Stalled/live coverage alerts distinguish expected import backlog; wrong-chain fails closed; no silent empty data |
| O5 | Turn off read cohorts/new dispatch during active ingestion and interrupted migration | Old compatible reads have verified provider entitlement; no duplicate legacy/new producer; observations retained for diagnosis |
| O6 | Same-release Sentry traces for middleware/DM/notification/estimate-fee plus Upstash status/error classes | Report endpoint P95 and pool/network timings; don't equate cumulative DB mean with request P95; identify actual failure cause before tuning |

## Existing baseline checks

```powershell
node --test --test-isolation=none src/lib/auth/__tests__/session-persistence.test.mjs src/lib/ops/__tests__/api-key-mode-isolation.test.mjs src/lib/ops/__tests__/webhook-environment-isolation.test.mjs src/lib/ops/__tests__/merchant-webhook-observability.test.mjs src/lib/ops/__tests__/payment-operations-durability.test.mjs
```

Planning audit result:32 passed. These are predominantly source-pattern regressions and do not substitute for U/I/E/O scenarios above.

After implementation, run targeted behavioral tests, lint, typecheck and static analysis; expand to related auth/CCTP/receipt/notification/security suites where those modules change. Use `node node_modules/next/dist/bin/next build` for a build-only verification: this repository's `npm run build` also applies migrations. Run migration rehearsal explicitly against the isolated test database, never as an accidental build side effect.
