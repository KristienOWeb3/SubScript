# Financial-flow audit remediation

Scope: all twelve findings and the adjacent recovery/deployment gaps in `docs/mainnet/MERCHANT_PAYMENTS_COMMIT_AUDIT_2026-10-16.md`.

## Implementation lanes

- Subscription lifecycle: S1/S2/S3. Preserve original cadence and paid-through in resume authorizations, derive entitlement from confirmed sequences, and keep scheduled access through expiry. Add contract and actual-handler tests. Resolve external-wallet workflow and custody-query errors.
- Payments: P1/P2/P3. Centralize USER transfer limits/blocks, persist accepted CCTP identities and recover burn evidence independently, and always drain unfinished completed-checkout effects. Add runtime and database crash/replay tests.
- Vault commit: C1/C2/C3/C4. Preserve unresolved client identities, reconcile before balance checks, persist environment and accepted operation/stage evidence, and recover asynchronously within request budgets. Test reload, malformed lookup, crash and timeout boundaries.
- Catalog/telemetry: S4/O1. Strict boolean catalog input and serialized current-state validation; truthful unknown/error metrics, proper sample scope, real stage measurements and non-overlapping visibility-aware refresh.

## Completion gates

- [ ] S1: full resume preserves first due date and subsequent original cadence; arbitrary callers cannot collect early.
- [ ] S2: cancel/resume/upgrade use the current verified entitlement after renewals/trials.
- [ ] S3: reconciliation preserves scheduled paid access until expiry and emits lifecycle events once.
- [ ] S4: both PATCH endpoints reject nonboolean activation and enforce capacity/targeted-offer eligibility under concurrency.
- [ ] P1: every callable USER transfer surface enforces the same spending and recipient policies, including ambiguous acceptance and replay.
- [ ] P2: accepted CCTP fee/approval/burn operations retain durable identities and recover after request termination.
- [ ] P3: completed-checkout replay drains unfinished effects with an existing receipt.
- [ ] C1: reload/lookup uncertainty keeps the original wallet/merchant request identity and gates new submission.
- [ ] C2: accepted same-ID commits reconcile before new-balance preflight.
- [ ] C3: intents persist and query actual network environment without rewriting unproven historical provenance.
- [ ] C4: approval and commit survive the route deadline through durable independent recovery and actual phase evidence.
- [ ] O1: telemetry reports unavailable data as unknown/error, uses measured intervals and documented percentiles, and prevents overlapping polls.
- [ ] Focused runtime/contract/database/client regressions, full security/contracts, TypeScript, lint, secret and whitespace gates pass.
- [ ] Review current deployed-contract compatibility and prepare concrete rollout/migration artifacts; no live financial signing during local implementation.

Parent owns this checklist and mainnet documentation. Agents own distinct code paths and report evidence before an item is checked.
