/* Make premium checkout, entitlement identity, recurring-charge recovery and renewal DMs
 * durable. All functions are service-only and keep claim ownership in the write predicate. */

/* Canonical Premium identity: merchant_address is the paying SubScript merchant account;
 * subscriber repeats that account for protocol/webhook correlation. The on-chain recipient is
 * the treasury and must never replace the account owner in this mirror. */
INSERT INTO public.merchants (wallet_address, tier, updated_at)
SELECT DISTINCT lower(subscriber), 'PREMIUM', now()
FROM public.subscriptions
WHERE kind = 'PREMIUM'
  AND subscriber IS NOT NULL
  AND lower(merchant_address) <> lower(subscriber)
ON CONFLICT (wallet_address) DO UPDATE SET tier = 'PREMIUM', updated_at = EXCLUDED.updated_at;

UPDATE public.subscriptions
SET merchant_address = lower(subscriber),
    subscriber = lower(subscriber),
    tier = 1,
    updated_at = now()
WHERE kind = 'PREMIUM'
  AND subscriber IS NOT NULL
  AND lower(merchant_address) <> lower(subscriber);

UPDATE public.subscriptions
SET subscriber = lower(merchant_address),
    tier = 1,
    updated_at = now()
WHERE kind = 'PREMIUM'
  AND subscriber IS NULL;

/* Collapse legacy concurrent sessions before enforcing one live checkout per merchant. */
WITH ranked AS (
    SELECT session_id,
           row_number() OVER (
               PARTITION BY lower(merchant_address)
               ORDER BY created_at DESC, session_id DESC
           ) AS position
    FROM public.payment_sessions
    WHERE status IN ('PENDING', 'PROCESSING')
)
UPDATE public.payment_sessions AS session
SET status = 'FAILED',
    last_error = 'Superseded by a newer premium checkout session.',
    failure_code = 'SUPERSEDED_SESSION',
    processing_claim_id = NULL,
    processing_started_at = NULL,
    updated_at = now()
FROM ranked
WHERE ranked.session_id = session.session_id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_one_live_premium_checkout
    ON public.payment_sessions ((lower(merchant_address)))
    WHERE status IN ('PENDING', 'PROCESSING');

CREATE OR REPLACE FUNCTION public.get_or_create_premium_payment_session(
    p_merchant_address TEXT,
    p_amount_expected BIGINT,
    p_chain_id INTEGER,
    p_ttl_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE(session_id UUID, expires_at TIMESTAMPTZ, status TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    normalized_merchant TEXT := lower(p_merchant_address);
BEGIN
    IF normalized_merchant !~ '^0x[0-9a-f]{40}$'
       OR p_amount_expected <= 0
       OR p_chain_id <= 0
       OR p_ttl_seconds < 300
       OR p_ttl_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid premium checkout parameters';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('premium-checkout:' || normalized_merchant, 0));

    INSERT INTO public.merchants (wallet_address, tier, updated_at)
    VALUES (normalized_merchant, 'FREE', now())
    ON CONFLICT (wallet_address) DO UPDATE SET updated_at = now();

    UPDATE public.payment_sessions
    SET status = 'FAILED',
        last_error = 'Premium checkout session expired.',
        failure_code = 'SESSION_EXPIRED',
        processing_claim_id = NULL,
        processing_started_at = NULL,
        updated_at = now()
    WHERE lower(merchant_address) = normalized_merchant
      AND status IN ('PENDING', 'PROCESSING')
      AND expires_at <= now();

    RETURN QUERY
    SELECT existing.session_id, existing.expires_at, existing.status
    FROM public.payment_sessions AS existing
    WHERE lower(existing.merchant_address) = normalized_merchant
      AND existing.status IN ('PENDING', 'PROCESSING')
      AND existing.expires_at > now()
    ORDER BY existing.created_at DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    RETURN QUERY
    INSERT INTO public.payment_sessions (
        merchant_address, amount_expected, chain_id, status, expires_at, updated_at
    ) VALUES (
        normalized_merchant, p_amount_expected, p_chain_id, 'PENDING',
        now() + make_interval(secs => p_ttl_seconds), now()
    )
    RETURNING payment_sessions.session_id, payment_sessions.expires_at, payment_sessions.status;
END;
$$;

/* An expired checkout may still have a canonical payment mined after its deadline. Allow that
 * previously-unbound session to claim exactly one tx so verification can grant the paid service;
 * the globally unique tx_hash and canonical event checks still prevent replay/substitution. */
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
    IF p_claim_id IS NULL OR p_tx_hash !~ '^0x[0-9A-Fa-f]{64}$' THEN
        RAISE EXCEPTION 'valid p_claim_id and p_tx_hash are required' USING ERRCODE = '22004';
    END IF;

    RETURN QUERY
    UPDATE public.payment_sessions AS session
    SET tx_hash = lower(p_tx_hash), status = 'PROCESSING', processing_started_at = now(),
        processing_claim_id = p_claim_id, updated_at = now()
    WHERE session.session_id = p_session_id
      AND (
          (session.status = 'PENDING' AND session.tx_hash IS NULL)
          OR (
              session.status = 'FAILED'
              AND session.tx_hash IS NULL
              AND session.failure_code = 'SESSION_EXPIRED'
          )
          OR (
              lower(session.tx_hash) = lower(p_tx_hash)
              AND (
                  (session.status IN ('PENDING', 'FAILED') AND session.processing_attempts < 5)
                  OR session.status = 'NEEDS_RECONCILIATION'
                  OR (session.status = 'PROCESSING' AND session.processing_started_at < now() - interval '10 minutes')
                  OR (
                      session.status = 'FAILED_PERMANENTLY'
                      AND (
                          session.failure_code IN ('DUPLICATE_TX', 'RPC_TIMEOUT', 'UNKNOWN_ERROR', 'RECONCILIATION_CRASH')
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

/* Keep activation atomic and write canonical micro-USDC / Premium identity. */
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
DECLARE
    normalized_merchant TEXT := lower(p_merchant_address);
BEGIN
    IF normalized_merchant !~ '^0x[0-9a-f]{40}$'
       OR p_subscription_id <= 0
       OR p_amount <= 0
       OR p_period <= 0 THEN
        RAISE EXCEPTION 'invalid premium activation parameters';
    END IF;

    PERFORM 1
    FROM public.payment_sessions AS session
    WHERE session.session_id = p_session_id
      AND session.status = 'PROCESSING'
      AND session.processing_claim_id = p_claim_id
      AND lower(session.tx_hash) = lower(p_tx_hash)
      AND lower(session.merchant_address) = normalized_merchant
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'premium payment session claim is no longer owned' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.merchants (wallet_address, tier, updated_at)
    VALUES (normalized_merchant, 'PREMIUM', now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 'PREMIUM', updated_at = now();

    INSERT INTO public.subscriptions (
        subscription_id, merchant_address, subscriber, current_nonce,
        last_settlement_timestamp, billing_interval_seconds, amount_cap_usdc,
        payment_tx_hash, status, kind, tier, updated_at
    ) VALUES (
        p_subscription_id, normalized_merchant, normalized_merchant, 0,
        now(), p_period, p_amount, lower(p_tx_hash), 'ACTIVE', 'PREMIUM', 1, now()
    )
    ON CONFLICT (subscription_id) DO UPDATE SET
        merchant_address = normalized_merchant,
        subscriber = normalized_merchant,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = lower(p_tx_hash),
        status = 'ACTIVE',
        kind = 'PREMIUM',
        tier = 1,
        updated_at = now();

    UPDATE public.payment_sessions
    SET status = 'COMPLETED', processing_claim_id = NULL, processing_started_at = NULL,
        last_error = NULL, failure_code = NULL, updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'PROCESSING'
      AND processing_claim_id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'premium payment session ownership changed during activation';
    END IF;
END;
$$;

/* A chain-confirmed renewal is no longer a disposable PROCESSING lease. Persist the transaction
 * before mirror/webhook/DM work so a replacement worker repairs those effects without charging. */
ALTER TABLE public.subscription_billing_claims
    DROP CONSTRAINT IF EXISTS subscription_billing_claims_status_check;
ALTER TABLE public.subscription_billing_claims
    ADD CONSTRAINT subscription_billing_claims_status_check
    CHECK (status IN ('PROCESSING', 'CHAIN_CONFIRMED', 'COMPLETED'));

/* Plan-change proration is also a money-moving state machine; preserve its paid/recovery phases. */
ALTER TABLE public.idempotency_keys DROP CONSTRAINT IF EXISTS check_idempotency_status;
ALTER TABLE public.idempotency_keys
    ADD CONSTRAINT check_idempotency_status
    CHECK (status IN ('PROCESSING', 'PRORATION_PAID', 'RECONCILIATION_REQUIRED', 'COMPLETED', 'FAILED'));

CREATE OR REPLACE FUNCTION public.record_subscription_billing_chain_confirmation(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_tx_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH recorded AS (
        UPDATE public.subscription_billing_claims
        SET status = 'CHAIN_CONFIRMED', tx_hash = lower(p_tx_hash), updated_at = now()
        WHERE subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
          AND p_tx_hash ~ '^0x[0-9A-Fa-f]{64}$'
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM recorded);
$$;

CREATE OR REPLACE FUNCTION public.claim_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_lease_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE claimed BOOLEAN := false;
BEGIN
    IF p_subscription_id <= 0 OR p_sequence_id <= 0 OR p_claim_id IS NULL
       OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing claim parameters';
    END IF;
    INSERT INTO public.subscription_billing_claims (
        subscription_id, sequence_id, claim_id, status, lease_until
    ) VALUES (p_subscription_id, p_sequence_id, p_claim_id, 'PROCESSING', now() + make_interval(secs => p_lease_seconds))
    ON CONFLICT (subscription_id, sequence_id) DO UPDATE
    SET claim_id = EXCLUDED.claim_id,
        status = CASE
            WHEN public.subscription_billing_claims.status = 'CHAIN_CONFIRMED' THEN 'CHAIN_CONFIRMED'
            ELSE 'PROCESSING'
        END,
        lease_until = EXCLUDED.lease_until,
        updated_at = now()
    WHERE public.subscription_billing_claims.status <> 'COMPLETED'
      AND public.subscription_billing_claims.lease_until < now()
    RETURNING true INTO claimed;
    RETURN COALESCE(claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_lease_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE renewed BOOLEAN := false;
BEGIN
    IF p_claim_id IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing lease parameters';
    END IF;
    UPDATE public.subscription_billing_claims
    SET lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    WHERE subscription_id = p_subscription_id
      AND sequence_id = p_sequence_id
      AND claim_id = p_claim_id
      AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
      AND lease_until >= now()
    RETURNING true INTO renewed;
    RETURN COALESCE(renewed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_tx_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH completed AS (
        UPDATE public.subscription_billing_claims
        SET status = 'COMPLETED',
            tx_hash = COALESCE(lower(p_tx_hash), tx_hash),
            lease_until = now(), updated_at = now()
        WHERE subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM completed);
$$;

/* Only an uncharged attempt may be released and retried as a new claim. */
CREATE OR REPLACE FUNCTION public.release_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH released AS (
        DELETE FROM public.subscription_billing_claims
        WHERE subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status = 'PROCESSING'
          AND tx_hash IS NULL
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM released);
$$;

/* Renewal receipt messages are retried after chain finality but must appear once. */
ALTER TABLE public.subscript_dms ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS subscript_dms_dedupe_key_unique
    ON public.subscript_dms (dedupe_key);

REVOKE ALL ON FUNCTION public.get_or_create_premium_payment_session(TEXT, BIGINT, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_subscription_billing_chain_confirmation(BIGINT, BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT, UUID)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_or_create_premium_payment_session(TEXT, BIGINT, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.claim_premium_payment_session(UUID, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_premium_payment_session(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_subscription_billing_chain_confirmation(BIGINT, BIGINT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_subscription_billing(BIGINT, BIGINT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT, UUID) TO service_role;
