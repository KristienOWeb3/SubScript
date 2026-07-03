CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_address TEXT NOT NULL,
    referred_address TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'REGISTERED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX referrals_referrer_address_idx ON referrals(referrer_address);
