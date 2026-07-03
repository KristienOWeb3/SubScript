CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_address TEXT NOT NULL,
    referred_address TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'REGISTERED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_referrer_address_idx
    ON public.referrals(referrer_address);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_server_only ON public.referrals;
CREATE POLICY referrals_server_only
    ON public.referrals
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

REVOKE ALL PRIVILEGES ON TABLE public.referrals FROM anon, authenticated;
