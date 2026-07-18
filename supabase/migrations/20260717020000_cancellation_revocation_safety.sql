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
    ADD COLUMN IF NOT EXISTS revocation_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS revocation_claim_id UUID,
    ADD COLUMN IF NOT EXISTS revocation_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revocation_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revocation_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revocation_last_error TEXT;

/* Partial index over the retry queue. Built in-transaction (NOT CONCURRENTLY): CONCURRENTLY is
   illegal inside the pipeline the Supabase CLI applier uses for `supabase start` — CI and every
   local stack — so it can never be part of a portable migration. On the testnet subscriptions
   table a plain build is milliseconds and blocks writes only briefly, never reads. */
CREATE INDEX IF NOT EXISTS subscriptions_revocation_pending_idx
    ON public.subscriptions (revocation_next_attempt_at, subscription_id)
    WHERE revocation_pending = true;

/* Claim an ordered retry batch with row leases. Permanently failing early rows back off, so later
   eligible cancellations cannot be starved by a fixed LIMIT scan. */
CREATE OR REPLACE FUNCTION public.claim_pending_subscription_revocations(
    p_claim_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_lease_seconds INTEGER DEFAULT 180
)
RETURNS TABLE (
    subscription_id BIGINT,
    merchant_address TEXT,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_claim_id IS NULL THEN
        RAISE EXCEPTION 'revocation claim id is required';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT sub.subscription_id
        FROM public.subscriptions AS sub
        WHERE sub.kind = 'CUSTOMER'
          AND sub.revocation_pending = true
          AND (sub.revocation_next_attempt_at IS NULL OR sub.revocation_next_attempt_at <= now())
          AND (sub.revocation_lease_expires_at IS NULL OR sub.revocation_lease_expires_at <= now())
        ORDER BY sub.revocation_next_attempt_at ASC NULLS FIRST, sub.subscription_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(COALESCE(p_limit, 100), 250))
    )
    UPDATE public.subscriptions AS sub
    SET revocation_claim_id = p_claim_id,
        revocation_lease_expires_at =
            now() + make_interval(secs => greatest(30, least(COALESCE(p_lease_seconds, 180), 600))),
        revocation_attempts = sub.revocation_attempts + 1,
        updated_at = now()
    FROM candidates
    WHERE sub.subscription_id = candidates.subscription_id
    RETURNING sub.subscription_id, sub.merchant_address, sub.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_subscription_revocation_claim(
    p_subscription_id BIGINT,
    p_claim_id UUID,
    p_tx_hash TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.subscriptions
    SET revocation_pending = false,
        revocation_tx_hash = COALESCE(lower(p_tx_hash), revocation_tx_hash),
        revocation_claim_id = NULL,
        revocation_lease_expires_at = NULL,
        revocation_next_attempt_at = NULL,
        revocation_attempts = 0,
        revocation_last_error = NULL,
        updated_at = now()
    WHERE subscription_id = p_subscription_id
      AND revocation_pending = true
      AND revocation_claim_id = p_claim_id
    RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.fail_subscription_revocation_claim(
    p_subscription_id BIGINT,
    p_claim_id UUID,
    p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.subscriptions
    SET revocation_claim_id = NULL,
        revocation_lease_expires_at = NULL,
        revocation_next_attempt_at = now() + make_interval(
            secs => least(
                3600,
                (30 * power(2, greatest(0, least(revocation_attempts - 1, 7))))::INTEGER
            )
        ),
        revocation_last_error = left(COALESCE(p_error, 'unknown revocation failure'), 500),
        updated_at = now()
    WHERE subscription_id = p_subscription_id
      AND revocation_pending = true
      AND revocation_claim_id = p_claim_id
    RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_subscription_revocations(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_subscription_revocations(UUID, INTEGER, INTEGER)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.complete_subscription_revocation_claim(BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_revocation_claim(BIGINT, UUID, TEXT)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.fail_subscription_revocation_claim(BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_subscription_revocation_claim(BIGINT, UUID, TEXT)
    TO service_role, postgres;
