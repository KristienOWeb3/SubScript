-- Production Hardening Migration
-- 1. Ensure columns exist on private_withdrawals and relax NOT NULL constraint
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS merchant_address TEXT;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS commitment_hash TEXT;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS nullifier_hash TEXT;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS withdrawal_tx_hash TEXT;
ALTER TABLE private_withdrawals ALTER COLUMN withdrawal_tx_hash DROP NOT NULL;

-- 2. Update payment_sessions check constraints
-- Dynamically find and drop any check constraint on status column of payment_sessions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'payment_sessions'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%status%'
    LOOP
        EXECUTE 'ALTER TABLE payment_sessions DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END;
$$;

ALTER TABLE payment_sessions ADD CONSTRAINT payment_sessions_status_check 
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'FAILED_PERMANENTLY', 'NEEDS_RECONCILIATION'));

-- 3. Update private_withdrawals check constraints to include PROCESSING
ALTER TABLE private_withdrawals DROP CONSTRAINT IF EXISTS check_withdrawal_status;
ALTER TABLE private_withdrawals ADD CONSTRAINT check_withdrawal_status 
    CHECK (status IN ('PENDING', 'PROCESSING', 'BROADCASTED', 'CONFIRMED', 'FAILED'));

-- 4. Clean up duplicate active payment sessions by setting older ones to FAILED
UPDATE payment_sessions p
SET status = 'FAILED', updated_at = now()
WHERE status IN ('PENDING', 'PROCESSING')
  AND EXISTS (
    SELECT 1
    FROM payment_sessions p2
    WHERE p2.merchant_address = p.merchant_address
      AND p2.status IN ('PENDING', 'PROCESSING')
      AND (
        p2.created_at > p.created_at
        OR (p2.created_at = p.created_at AND p2.session_id > p.session_id)
      )
  );

-- 5. Create partial unique index on payment_sessions for active sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_payment_sessions 
    ON payment_sessions (merchant_address) 
    WHERE (status IN ('PENDING', 'PROCESSING'));

-- 5. Re-define claim_pending_payment_sessions to exclude FAILED_PERMANENTLY and BUDGET_EXHAUSTED
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
        WHERE (
            status IN ('PENDING', 'FAILED')
            OR (status = 'PROCESSING' AND processing_started_at < now() - INTERVAL '10 minutes')
          )
          AND status NOT IN ('COMPLETED', 'FAILED_PERMANENTLY', 'NEEDS_RECONCILIATION')
          AND tx_hash IS NOT NULL
          AND processing_attempts < 5
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 6. Define atomic function for premium merchant activation
CREATE OR REPLACE FUNCTION activate_premium_merchant(
    p_merchant_address TEXT,
    p_subscription_id BIGINT,
    p_session_id UUID,
    p_tx_hash TEXT,
    p_amount NUMERIC,
    p_period BIGINT
) RETURNS VOID AS $$
BEGIN
    -- 1. Upsert merchant to tier 1
    INSERT INTO merchants (wallet_address, tier, updated_at)
    VALUES (p_merchant_address, 1, now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 1, updated_at = now();

    -- 2. Upsert premium subscription to ACTIVE
    INSERT INTO subscriptions (
        subscription_id, merchant_address, current_nonce, last_settlement_timestamp,
        billing_interval_seconds, amount_cap_usdc, payment_tx_hash, status, tier, updated_at
    )
    VALUES (
        p_subscription_id, p_merchant_address, 0, now(),
        p_period, p_amount, p_tx_hash, 'ACTIVE', 1, now()
    )
    ON CONFLICT (subscription_id)
    DO UPDATE SET
        merchant_address = p_merchant_address,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = p_tx_hash,
        status = 'ACTIVE',
        tier = 1,
        updated_at = now();

    -- 3. Mark payment session COMPLETED
    UPDATE payment_sessions
    SET status = 'COMPLETED', updated_at = now()
    WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;
