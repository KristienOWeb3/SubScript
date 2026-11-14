/*
 * Contract-scoped revocation claims, and a retryable subscribe-attempt state.
 *
 * 1. Revocation RPCs keyed on (contract_address, subscription_id).
 *
 *    claim_pending_subscription_revocations, complete_subscription_revocation_claim and
 *    fail_subscription_revocation_claim (20260717020000) matched rows on subscription_id alone.
 *    `subscriptions` has been keyed (contract_address, subscription_id) since 20260810140000,
 *    because the PSA is immutable and every redeploy restarts nextSubscriptionId at 1. So after a
 *    redeploy the claim could pick up a row minted by the OLD contract, and the keeper would read
 *    that id on the NEW contract and revoke whichever stranger's subscription now holds it. The
 *    complete/fail updates had the same reach: they wrote to every generation's copy of the id.
 *
 *    The old signatures are dropped, not overloaded, so no caller can keep using the unscoped
 *    form. The keeper passes p_contract_address = activeSubscriptionContract().
 *
 * 2. subscription_attempts.status gains FAILED_RETRYABLE.
 *
 *    The subscribe route used to mark any unrecognised failure FAILED_TERMINAL, and the attempt key
 *    for a (subscriber, merchant, plan, generation) never changes, so one "insufficient USDC" blocked
 *    every later try. A user-fixable failure is now FAILED_RETRYABLE and the next try mints a
 *    nonce-suffixed key. See src/lib/subscriptions/subscribeAttempts.ts.
 */

DROP FUNCTION IF EXISTS public.claim_pending_subscription_revocations(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.complete_subscription_revocation_claim(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.fail_subscription_revocation_claim(BIGINT, UUID, TEXT);

/* Claim an ordered retry batch with row leases, on one contract only. Permanently failing early
   rows back off, so later eligible cancellations cannot be starved by a fixed LIMIT scan. */
CREATE OR REPLACE FUNCTION public.claim_pending_subscription_revocations(
    p_contract_address TEXT,
    p_claim_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_lease_seconds INTEGER DEFAULT 180
)
RETURNS TABLE (
    contract_address TEXT,
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
    IF p_contract_address IS NULL OR lower(p_contract_address) !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'revocation claims must be scoped to a contract address';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT sub.contract_address, sub.subscription_id
        FROM public.subscriptions AS sub
        WHERE sub.contract_address = lower(p_contract_address)
          AND sub.kind = 'CUSTOMER'
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
    WHERE sub.contract_address = candidates.contract_address
      AND sub.subscription_id = candidates.subscription_id
    RETURNING sub.contract_address, sub.subscription_id, sub.merchant_address, sub.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_subscription_revocation_claim(
    p_contract_address TEXT,
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
    WHERE contract_address = lower(p_contract_address)
      AND subscription_id = p_subscription_id
      AND revocation_pending = true
      AND revocation_claim_id = p_claim_id
    RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.fail_subscription_revocation_claim(
    p_contract_address TEXT,
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
    WHERE contract_address = lower(p_contract_address)
      AND subscription_id = p_subscription_id
      AND revocation_pending = true
      AND revocation_claim_id = p_claim_id
    RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_subscription_revocations(TEXT, UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_subscription_revocations(TEXT, UUID, INTEGER, INTEGER)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.complete_subscription_revocation_claim(TEXT, BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_revocation_claim(TEXT, BIGINT, UUID, TEXT)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.fail_subscription_revocation_claim(TEXT, BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_subscription_revocation_claim(TEXT, BIGINT, UUID, TEXT)
    TO service_role, postgres;

/* The retry queue's partial index, now led by the contract the claim filters on. */
DROP INDEX IF EXISTS public.subscriptions_revocation_pending_idx;
CREATE INDEX IF NOT EXISTS subscriptions_revocation_pending_idx
    ON public.subscriptions (contract_address, revocation_next_attempt_at, subscription_id)
    WHERE revocation_pending = true;

/* FAILED_RETRYABLE. The original CHECK was declared inline, so its name is whatever Postgres
   generated; find it by definition rather than guess. */
DO $$
DECLARE
    v_constraint TEXT;
BEGIN
    IF to_regclass('public.subscription_attempts') IS NULL THEN
        RETURN;
    END IF;
    FOR v_constraint IN
        SELECT con.conname
          FROM pg_constraint AS con
         WHERE con.conrelid = 'public.subscription_attempts'::regclass
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%FAILED_TERMINAL%'
    LOOP
        EXECUTE format('ALTER TABLE public.subscription_attempts DROP CONSTRAINT %I', v_constraint);
    END LOOP;

    ALTER TABLE public.subscription_attempts
        ADD CONSTRAINT subscription_attempts_status_check
        CHECK (status IN (
            'PREPARED',
            'SUBMISSION_STARTED',
            'SUBMISSION_UNKNOWN',
            'CHAIN_CONFIRMED',
            'COMPLETED',
            'PROVEN_NOT_SUBMITTED',
            'FAILED_RETRYABLE',
            'FAILED_TERMINAL'
        ));
END;
$$;
