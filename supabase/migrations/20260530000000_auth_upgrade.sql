-- SQL Migration to support email OTP & Social login with embedded wallets

-- 1. Create otp_codes table
CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 2. Create user_embedded_wallets table
CREATE TABLE IF NOT EXISTS user_embedded_wallets (
    email TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS on these tables (block public direct reads, only server side service role bypass allowed)
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_embedded_wallets ENABLE ROW LEVEL SECURITY;

-- Note: No public/authenticated policies are created for these tables, ensuring that
-- only the backend server using the SERVICE_ROLE key has read/write configuration access.
