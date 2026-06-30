# Vault Economics

SubScript vaults provide real USDC escrow for pay-after-service merchants.

## Commitment and service

- A merchant publishes the minimum USDC commitment required for its service.
- A customer may deposit any positive amount, but service stays inactive below the minimum.
- Once the minimum is met, the vault becomes active for a rolling 30-day cycle.
- The committed balance is the hard service allowance. A larger commitment supports proportionally more billable usage; usage can never exceed the escrow.
- The merchant must report every billable unit through `POST /api/user/vault/report-usage`. The update is serialized per vault so concurrent requests cannot spend the same allowance twice.

## Reconciliation

- At cycle maturity, the SubScript keeper submits the recorded usage total on-chain.
- The vault pays at most the committed amount to the merchant ledger.
- Every unused USDC is returned automatically to the customer during the same settlement transaction.
- The vault closes and becomes inactive after settlement. The customer must make a fresh minimum commitment before the next service cycle.
- Settlement cannot happen before cycle maturity, and an active commitment cannot be withdrawn around reconciliation.
- The merchant pays the protocol's flat 1% fee when claiming settled funds.

## Exhaustion

If reported usage would exceed the remaining commitment, the usage API returns `402 COMMIT_EXHAUSTED`, records a direct customer notification, and sends browser push when enabled. No debt or negative balance is created.

## Trust boundary

The contract guarantees that a merchant cannot receive more than the customer's escrow and cannot settle before cycle maturity. SubScript serializes and caps usage reports, but the integrated merchant remains responsible for reporting honest service usage. Customers should commit only to merchants they trust and can identify.

## Real-only operation

Off-chain balance creation and simulated top-ups are disabled. Commit, settlement, refund, and merchant claim all move real USDC on-chain. The database is a read and gating mirror; it is not a source of funds.

## Operational requirements

- `KEEPER_PRIVATE_KEY` must be an authorized vault drawer.
- `CRON_SECRET` or `KEEPER_SECRET` authenticates the daily vault-draw job.
- Existing vault proxies must be upgraded with `initializeV2(treasury)` in the same `upgradeToAndCall` transaction.
- Contract changes require the full contract test suite and deployed-contract health check before use.
