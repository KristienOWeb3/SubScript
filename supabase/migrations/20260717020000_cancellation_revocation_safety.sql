/*
 * Cancellation revocation safety.
 *
 * "Cancel at period end" used to record a DB flag while leaving the on-chain PSA
 * authorization active until the daily keeper ran. executePayment is permissionless,
 * so the subscription remained chargeable in that window. The authorization is now
 * revoked on-chain at cancellation time; these columns track the revocation so a
 * failed revoke can never fall outside every worker query.
 *
 *   revocation_pending  — the on-chain authorization may still be active; the
 *                         cancellation retry worker keeps retrying until the chain
 *                         reports inactive or an operator resolves it.
 *   revocation_tx_hash  — the confirmed on-chain cancel transaction.
 */

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS revocation_pending BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS revocation_tx_hash TEXT;

/* Partial index so the retry worker's scan stays cheap regardless of table size. */
CREATE INDEX IF NOT EXISTS subscriptions_revocation_pending_idx
    ON public.subscriptions (subscription_id)
    WHERE revocation_pending = true;
