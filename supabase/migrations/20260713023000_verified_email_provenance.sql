ALTER TABLE public.user_embedded_wallets
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Email OTP and Circle Google both prove mailbox ownership before persisting
-- the account. Legacy external-wallet emails were merely user supplied and
-- intentionally remain unverified until the owner completes BIND_WALLET_EMAIL.
UPDATE public.user_embedded_wallets
   SET email_verified_at = COALESCE(email_verified_at, updated_at, now())
 WHERE email IS NOT NULL
   AND provider IN ('email_otp', 'circle_google');

CREATE INDEX IF NOT EXISTS user_embedded_wallets_verified_email_idx
    ON public.user_embedded_wallets (wallet_address, email_verified_at)
    WHERE email IS NOT NULL AND email_verified_at IS NOT NULL;
