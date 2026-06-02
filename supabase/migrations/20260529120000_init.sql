/* Supabase Database Migration Schema */
/* Shift off-chain protocol tracking to Supabase instance */

/* 1. Create merchants table */
CREATE TABLE IF NOT EXISTS merchants (
    wallet_address TEXT PRIMARY KEY,
    tier INT NOT NULL DEFAULT 0,
    payout_destination TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

/* 2. Create subscriptions table */
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id BIGINT PRIMARY KEY,
    merchant_address TEXT REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    current_nonce INT DEFAULT 0,
    last_settlement_timestamp TIMESTAMPTZ,
    billing_interval_seconds BIGINT,
    amount_cap_usdc NUMERIC,
    payment_tx_hash TEXT UNIQUE DEFAULT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED')),
    tier INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

/* 3. Create payment_sessions table */
CREATE TABLE IF NOT EXISTS payment_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    tx_hash TEXT UNIQUE,
    amount_expected BIGINT NOT NULL DEFAULT 10000000,
    chain_id INT NOT NULL DEFAULT 5042002,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    processing_by TEXT NULL,
    processing_started_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 minutes')
);

/* 4. Create webhook_events table */
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_endpoint_id UUID,
    event TEXT,
    status INT,
    payload JSONB,
    response_body TEXT,
    tx_hash TEXT UNIQUE,
    event_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

/* 5. Enable Row Level Security (RLS) on all tables */
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

/* 6. Row-Level Security Policies (authenticated select/update via custom JWT wallet claim) */

CREATE POLICY merchants_access_policy ON merchants
    FOR ALL
    USING (LOWER(wallet_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(wallet_address) = LOWER(auth.jwt() ->> 'wallet_address'));

CREATE POLICY subscriptions_access_policy ON subscriptions
    FOR ALL
    USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

CREATE POLICY payment_sessions_access_policy ON payment_sessions
    FOR ALL
    USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

/* 7. Performance Indexes */
CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant_address ON subscriptions(merchant_address);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_merchant ON payment_sessions(merchant_address);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_tx_hash ON payment_sessions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tx_hash ON webhook_events(tx_hash);

/* 8. Trigger to auto-update the updated_at timestamp on updates */
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER trigger_update_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_payment_sessions_updated_at
    BEFORE UPDATE ON payment_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

/* 9. Create waitlist_leads table */
CREATE TABLE IF NOT EXISTS waitlist_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    user_type TEXT,
    wallet_address TEXT UNIQUE,
    company_name TEXT,
    use_case TEXT,
    monthly_volume TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE waitlist_leads ENABLE ROW LEVEL SECURITY;

/* 10. Atomic Claim Function */
CREATE OR REPLACE FUNCTION claim_pending_payment_sessions(batch_size INT)
RETURNS SETOF payment_sessions AS $$
BEGIN
    RETURN QUERY
    UPDATE payment_sessions
    SET status = 'PROCESSING',
        processing_started_at = now()
    WHERE session_id IN (
        SELECT session_id
        FROM payment_sessions
        WHERE status IN ('PENDING', 'FAILED')
          AND tx_hash IS NOT NULL
          AND expires_at > now()
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;
