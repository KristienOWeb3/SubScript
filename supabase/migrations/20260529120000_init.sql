-- Supabase Database Migration Schema
-- Shift off-chain protocol tracking to Supabase instance

-- 1. Create merchants table
CREATE TABLE IF NOT EXISTS merchants (
    wallet_address TEXT PRIMARY KEY,
    tier SMALLINT DEFAULT 0 CHECK (tier IN (0, 1)),
    payout_destination TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id BIGINT PRIMARY KEY,
    merchant_address TEXT REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    current_nonce INT DEFAULT 0,
    last_settlement_timestamp TIMESTAMPTZ,
    billing_interval_seconds BIGINT,
    amount_cap_usdc NUMERIC,
    next_valid_commitment TEXT DEFAULT NULL,
    status TEXT DEFAULT 'PENDING',
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Enable Row Level Security (RLS) on all tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- 5. Row-Level Security Policies (authenticated select/update via custom JWT wallet claim)

-- Policy for merchants: select or update only if their wallet address matches the authenticated wallet address
CREATE POLICY merchants_access_policy ON merchants
    FOR ALL
    USING (LOWER(wallet_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(wallet_address) = LOWER(auth.jwt() ->> 'wallet_address'));

-- Policy for subscriptions: select or update only if the merchant address matches the authenticated wallet address
CREATE POLICY subscriptions_access_policy ON subscriptions
    FOR ALL
    USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

-- Note: The webhook_events table has RLS enabled but has NO policies created.
-- This effectively blocks all public and authenticated user access, leaving it exclusively 
-- writable and readable via the Supabase Service Role key environment bypass.

-- 6. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant_address ON subscriptions(merchant_address);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tx_hash ON webhook_events(tx_hash);

-- 7. Trigger to auto-update the updated_at timestamp on subscription updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER trigger_update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
