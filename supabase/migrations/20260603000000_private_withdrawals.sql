-- Create private_withdrawals table for routing audit trail
CREATE TABLE IF NOT EXISTS private_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    destination TEXT NOT NULL,
    commitment_hash TEXT NOT NULL,
    nullifier_hash TEXT NOT NULL,
    withdrawal_tx_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security and enforce Default Deny policy
ALTER TABLE private_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all public access" ON private_withdrawals FOR ALL USING (false);

-- Re-define the claim_pending_payment_sessions function to support reclaiming jobs
-- and verifying sessions that are expired but have a transaction hash
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
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;
