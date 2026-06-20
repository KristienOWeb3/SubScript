-- Create metered_vaults table
CREATE TABLE IF NOT EXISTS metered_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL REFERENCES customers(wallet_address) ON DELETE CASCADE,
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    balance_usdc BIGINT NOT NULL DEFAULT 0,
    threshold_usdc BIGINT NOT NULL DEFAULT 2000000, -- Default $2.00
    top_up_amount_usdc BIGINT NOT NULL DEFAULT 10000000, -- Default $10.00
    monthly_limit_usdc BIGINT NOT NULL DEFAULT 50000000, -- Default $50.00
    monthly_spent_usdc BIGINT NOT NULL DEFAULT 0,
    last_top_up_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_address, merchant_address)
);

CREATE INDEX IF NOT EXISTS metered_vaults_user_address_idx ON metered_vaults(user_address);
CREATE INDEX IF NOT EXISTS metered_vaults_merchant_address_idx ON metered_vaults(merchant_address);

ALTER TABLE metered_vaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on metered_vaults" ON metered_vaults;
CREATE POLICY "Deny all public access on metered_vaults" ON metered_vaults FOR ALL USING (false);
