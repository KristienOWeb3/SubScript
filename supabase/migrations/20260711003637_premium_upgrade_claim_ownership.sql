/*
 * Give each premium-upgrade processor an explicit lease token. This prevents a stale
 * request from downgrading a session after reconciliation has reclaimed it, while still
 * allowing the same session and transaction hash to resume after a transient failure.
 */

ALTER TABLE public.payment_sessions
    ADD COLUMN IF NOT EXISTS processing_claim_id UUID;

DROP FUNCTION IF EXISTS public.claim_pending_payment_sessions(INT);

CREATE OR REPLACE FUNCTION public.claim_pending_payment_sessions(batch_size INT, p_claim_id UUID)
RETURNS SETOF public.payment_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF p_claim_id IS NULL THEN
        RAISE EXCEPTION 'p_claim_id is required' USING ERRCODE = '22004';
    END IF;

    IF batch_size <= 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE public.payment_sessions AS session
    SET status = 'PROCESSING',
        processing_started_at = now(),
        processing_claim_id = p_claim_id,
        updated_at = now()
    WHERE session.session_id IN (
        SELECT candidate.session_id
        FROM public.payment_sessions AS candidate
        WHERE candidate.tx_hash IS NOT NULL
          AND (
              (
                  candidate.status IN ('PENDING', 'FAILED')
                  AND candidate.processing_attempts < 5
              )
              OR candidate.status = 'NEEDS_RECONCILIATION'
              OR (
                  candidate.status = 'PROCESSING'
                  AND candidate.processing_started_at < now() - INTERVAL '10 minutes'
              )
              OR (
                  candidate.status = 'FAILED_PERMANENTLY'
                  AND (
                      candidate.failure_code IN (
                          'DUPLICATE_TX',
                          'RPC_TIMEOUT',
                          'UNKNOWN_ERROR',
                          'RECONCILIATION_CRASH'
                      )
                      OR (
                          candidate.failure_code = 'VERIFICATION_FAILED'
                          AND candidate.last_error ~* 'sender does not match session merchant|receipt sender does not match session merchant|transaction sender does not match session owner'
                      )
                  )
              )
          )
        ORDER BY candidate.updated_at ASC, candidate.session_id ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING session.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_premium_payment_session(
    p_session_id UUID,
    p_tx_hash TEXT,
    p_claim_id UUID
)
RETURNS SETOF public.payment_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF p_claim_id IS NULL OR p_tx_hash IS NULL OR btrim(p_tx_hash) = '' THEN
        RAISE EXCEPTION 'p_claim_id and p_tx_hash are required' USING ERRCODE = '22004';
    END IF;

    RETURN QUERY
    UPDATE public.payment_sessions AS session
    SET tx_hash = lower(p_tx_hash),
        status = 'PROCESSING',
        processing_started_at = now(),
        processing_claim_id = p_claim_id,
        updated_at = now()
    WHERE session.session_id = p_session_id
      AND (
          (session.status = 'PENDING' AND session.tx_hash IS NULL)
          OR (
              lower(session.tx_hash) = lower(p_tx_hash)
              AND (
                  (session.status IN ('PENDING', 'FAILED') AND session.processing_attempts < 5)
                  OR session.status = 'NEEDS_RECONCILIATION'
                  OR (
                      session.status = 'PROCESSING'
                      AND session.processing_started_at < now() - INTERVAL '10 minutes'
                  )
                  OR (
                      session.status = 'FAILED_PERMANENTLY'
                      AND (
                          session.failure_code IN (
                              'DUPLICATE_TX',
                              'RPC_TIMEOUT',
                              'UNKNOWN_ERROR',
                              'RECONCILIATION_CRASH'
                          )
                          OR (
                              session.failure_code = 'VERIFICATION_FAILED'
                              AND session.last_error ~* 'sender does not match session merchant|receipt sender does not match session merchant|transaction sender does not match session owner'
                          )
                      )
                  )
              )
          )
      )
    RETURNING session.*;
END;
$$;

DROP FUNCTION IF EXISTS public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT);

CREATE OR REPLACE FUNCTION public.activate_premium_merchant(
    p_merchant_address TEXT,
    p_subscription_id BIGINT,
    p_session_id UUID,
    p_tx_hash TEXT,
    p_amount NUMERIC,
    p_period BIGINT,
    p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    /* Lock and validate ownership before changing entitlement state. */
    PERFORM 1
    FROM public.payment_sessions AS session
    WHERE session.session_id = p_session_id
      AND session.status = 'PROCESSING'
      AND session.processing_claim_id = p_claim_id
      AND lower(session.tx_hash) = lower(p_tx_hash)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'premium payment session claim is no longer owned'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.merchants (wallet_address, tier, updated_at)
    VALUES (p_merchant_address, 'PREMIUM', now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 'PREMIUM', updated_at = now();

    INSERT INTO public.subscriptions (
        subscription_id,
        merchant_address,
        current_nonce,
        last_settlement_timestamp,
        billing_interval_seconds,
        amount_cap_usdc,
        payment_tx_hash,
        status,
        updated_at
    )
    VALUES (
        p_subscription_id,
        p_merchant_address,
        0,
        now(),
        p_period,
        p_amount,
        p_tx_hash,
        'ACTIVE',
        now()
    )
    ON CONFLICT (subscription_id)
    DO UPDATE SET
        merchant_address = p_merchant_address,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = p_tx_hash,
        status = 'ACTIVE',
        updated_at = now();

    UPDATE public.payment_sessions
    SET status = 'COMPLETED',
        processing_claim_id = NULL,
        processing_started_at = NULL,
        last_error = NULL,
        failure_code = NULL,
        updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'PROCESSING'
      AND processing_claim_id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_payment_sessions(INT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_premium_payment_session(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_payment_sessions(INT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_premium_payment_session(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT, UUID) TO service_role;
