/* Bind OTPs to their intended authentication flow and wallet. */
ALTER TABLE public.otp_codes
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'LOGIN',
    ADD COLUMN IF NOT EXISTS wallet_address TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'otp_codes_purpose_check'
          AND conrelid = 'public.otp_codes'::regclass
    ) THEN
        ALTER TABLE public.otp_codes
            ADD CONSTRAINT otp_codes_purpose_check
            CHECK (purpose IN ('LOGIN', 'BIND_WALLET_EMAIL'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS otp_codes_purpose_wallet_idx
    ON public.otp_codes (purpose, wallet_address);

/* Lease one on-chain billing sequence to one worker. */
CREATE TABLE IF NOT EXISTS public.subscription_billing_claims (
    subscription_id BIGINT NOT NULL,
    sequence_id BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'COMPLETED')),
    lease_until TIMESTAMPTZ NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subscription_id, sequence_id)
);

ALTER TABLE public.subscription_billing_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on subscription_billing_claims"
    ON public.subscription_billing_claims;
CREATE POLICY "Deny all public access on subscription_billing_claims"
    ON public.subscription_billing_claims
    FOR ALL
    USING (false)
    WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.claim_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
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
    IF p_subscription_id <= 0 OR p_sequence_id <= 0 OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing claim parameters';
    END IF;

    INSERT INTO public.subscription_billing_claims (
        subscription_id,
        sequence_id,
        status,
        lease_until
    ) VALUES (
        p_subscription_id,
        p_sequence_id,
        'PROCESSING',
        NOW() + make_interval(secs => p_lease_seconds)
    )
    ON CONFLICT (subscription_id, sequence_id) DO UPDATE
    SET status = 'PROCESSING',
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
    p_tx_hash TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.subscription_billing_claims
    SET status = 'COMPLETED',
        tx_hash = p_tx_hash,
        lease_until = NOW(),
        updated_at = NOW()
    WHERE subscription_id = p_subscription_id
      AND sequence_id = p_sequence_id;
$$;

CREATE OR REPLACE FUNCTION public.release_subscription_billing(
    p_subscription_id BIGINT,
    p_sequence_id BIGINT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    DELETE FROM public.subscription_billing_claims
    WHERE subscription_id = p_subscription_id
      AND sequence_id = p_sequence_id
      AND status = 'PROCESSING';
$$;

REVOKE ALL ON TABLE public.subscription_billing_claims FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_billing(BIGINT, BIGINT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_subscription_billing(BIGINT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_subscription_billing(BIGINT, BIGINT) TO service_role;
