-- 1. Alter payment_sessions table to track processing attempts and errors
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS processing_attempts INT DEFAULT 0;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS last_error TEXT DEFAULT NULL;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS failure_code TEXT DEFAULT NULL;

-- 2. Re-define claim_pending_payment_sessions PL/pgSQL function to enforce attempt limits and timeout reclaiming
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
          AND tx_hash IS NOT NULL
          AND processing_attempts < 5
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 3. Safely update private_withdrawals schema without dropping existing tables
-- Attempt to rename destination column if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'private_withdrawals' AND column_name = 'destination'
    ) THEN
        ALTER TABLE private_withdrawals RENAME COLUMN destination TO destination_address;
    END IF;
END $$;

ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT NULL;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS proof_type TEXT DEFAULT 'commit_reveal';

-- Add unique constraint to nullifier_hash to ensure idempotency and prevent duplicate records
ALTER TABLE private_withdrawals DROP CONSTRAINT IF EXISTS private_withdrawals_nullifier_hash_key;
ALTER TABLE private_withdrawals ADD CONSTRAINT private_withdrawals_nullifier_hash_key UNIQUE (nullifier_hash);

-- 4. Create premium_upgrade_events audit table for upgrade events
CREATE TABLE IF NOT EXISTS premium_upgrade_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant TEXT NOT NULL,
    payment_session UUID UNIQUE NOT NULL REFERENCES payment_sessions(session_id) ON DELETE CASCADE,
    tx_hash TEXT UNIQUE NOT NULL,
    chain_id INT NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT now(),
    tier_before INT NOT NULL,
    tier_after INT NOT NULL,
    admin_wallet TEXT NOT NULL,
    activation_tx_hash TEXT NOT NULL
);

-- Enable Row Level Security and enforce Default Deny policy on the new audit table
ALTER TABLE premium_upgrade_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all public access on premium_upgrade_events" ON premium_upgrade_events FOR ALL USING (false);
