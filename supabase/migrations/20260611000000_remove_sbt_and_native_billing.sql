/* Migration to remove SBT infrastructure and support native recurring billing */

/* 1. Remove SBT-related database objects */
DROP TRIGGER IF EXISTS trigger_update_sbt_mint_jobs_updated_at ON sbt_mint_jobs;
DROP FUNCTION IF EXISTS claim_pending_sbt_mint_jobs(batch_size INT, p_worker_id TEXT);
DROP TABLE IF EXISTS sbt_mint_jobs;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS sbt_token_id;

/* 2. Alter merchants table tier column to be TEXT with CHECK constraint ('FREE', 'PREMIUM') */
ALTER TABLE merchants ALTER COLUMN tier DROP DEFAULT;

/* Modify type of tier using CASE statement and drop the check constraint if already exists */
ALTER TABLE merchants ALTER COLUMN tier TYPE TEXT USING (
    CASE 
        WHEN tier = 1 THEN 'PREMIUM'
        ELSE 'FREE'
    END
);
ALTER TABLE merchants ALTER COLUMN tier SET DEFAULT 'FREE';
ALTER TABLE merchants ADD CONSTRAINT check_merchant_tier_valid CHECK (tier IN ('FREE', 'PREMIUM'));

/* 3. Add subscriber column to subscriptions table */
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscriber TEXT DEFAULT NULL;

/* 4. Redefine activate_premium_merchant database function to support text-based merchant tiers */
CREATE OR REPLACE FUNCTION activate_premium_merchant(
    p_merchant_address TEXT,
    p_subscription_id BIGINT,
    p_session_id UUID,
    p_tx_hash TEXT,
    p_amount NUMERIC,
    p_period BIGINT
) RETURNS VOID AS $$
BEGIN
    /* 1. Upsert merchant to tier PREMIUM */
    INSERT INTO merchants (wallet_address, tier, updated_at)
    VALUES (p_merchant_address, 'PREMIUM', now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 'PREMIUM', updated_at = now();

    /* 2. Upsert premium subscription to ACTIVE */
    INSERT INTO subscriptions (
        subscription_id, merchant_address, current_nonce, last_settlement_timestamp,
        billing_interval_seconds, amount_cap_usdc, payment_tx_hash, status, updated_at
    )
    VALUES (
        p_subscription_id, p_merchant_address, 0, now(),
        p_period, p_amount, p_tx_hash, 'ACTIVE', now()
    )
    ON CONFLICT (subscription_id)
    DO UPDATE SET
        merchant_address = p_merchant_address,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = p_tx_hash,
        status = 'ACTIVE',
        updated_at = now();

    /* 3. Mark payment session COMPLETED */
    UPDATE payment_sessions
    SET status = 'COMPLETED', updated_at = now()
    WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;
