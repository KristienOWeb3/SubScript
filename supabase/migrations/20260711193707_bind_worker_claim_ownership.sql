/* Prevent expired webhook and recurring-billing workers from finalizing a lease after a
 * replacement worker has reclaimed it. Every claim rotates a UUID, and terminal writes must
 * present the active UUID in addition to the row's business key. */

ALTER TABLE public.webhook_deliveries
    ADD COLUMN IF NOT EXISTS processing_claim_id UUID;

CREATE INDEX IF NOT EXISTS webhook_deliveries_processing_claim_idx
    ON public.webhook_deliveries (processing_claim_id)
    WHERE status = 'PROCESSING';

ALTER TABLE public.subscription_billing_claims
    ADD COLUMN IF NOT EXISTS claim_id UUID;

UPDATE public.subscription_billing_claims
SET claim_id = gen_random_uuid()
WHERE claim_id IS NULL;

ALTER TABLE public.subscription_billing_claims
    ALTER COLUMN claim_id SET NOT NULL;

DROP FUNCTION IF EXISTS public.claim_subscription_billing(BIGINT, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS public.complete_subscription_billing(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.release_subscription_billing(BIGINT, BIGINT);

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
DECLARE
    claimed BOOLEAN := false;
BEGIN
    IF p_subscription_id <= 0
        OR p_sequence_id <= 0
        OR p_claim_id IS NULL
        OR p_lease_seconds < 30
        OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing claim parameters';
    END IF;

    INSERT INTO public.subscription_billing_claims (
        subscription_id,
        sequence_id,
        claim_id,
        status,
        lease_until
    ) VALUES (
        p_subscription_id,
        p_sequence_id,
        p_claim_id,
        'PROCESSING',
        NOW() + make_interval(secs => p_lease_seconds)
    )
    ON CONFLICT (subscription_id, sequence_id) DO UPDATE
    SET claim_id = EXCLUDED.claim_id,
        status = 'PROCESSING',
        lease_until = EXCLUDED.lease_until,
        tx_hash = NULL,
        updated_at = NOW()
    WHERE public.subscription_billing_claims.status <> 'COMPLETED'
      AND public.subscription_billing_claims.lease_until < NOW()
    RETURNING true INTO claimed;

    RETURN COALESCE(claimed, false);
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
            tx_hash = p_tx_hash,
            lease_until = NOW(),
            updated_at = NOW()
        WHERE subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status = 'PROCESSING'
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM completed);
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
DECLARE
    renewed BOOLEAN := false;
BEGIN
    IF p_claim_id IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing lease parameters';
    END IF;

    UPDATE public.subscription_billing_claims
    SET lease_until = NOW() + make_interval(secs => p_lease_seconds),
        updated_at = NOW()
    WHERE subscription_id = p_subscription_id
      AND sequence_id = p_sequence_id
      AND claim_id = p_claim_id
      AND status = 'PROCESSING'
      AND lease_until >= NOW()
    RETURNING true INTO renewed;

    RETURN COALESCE(renewed, false);
END;
$$;

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
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM released);
$$;

REVOKE ALL ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT, UUID)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, UUID, TEXT)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_subscription_billing(BIGINT, BIGINT, UUID, INTEGER)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT, UUID)
    TO service_role;
