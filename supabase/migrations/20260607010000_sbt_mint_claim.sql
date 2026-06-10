/* SQL Migration for SBT Minting Jobs Claiming Function */

CREATE OR REPLACE FUNCTION claim_pending_sbt_mint_jobs(batch_size INT, p_worker_id TEXT)
RETURNS SETOF sbt_mint_jobs AS $$
BEGIN
    RETURN QUERY
    UPDATE sbt_mint_jobs
    SET status = 'PROCESSING',
        locked_at = now(),
        locked_by = p_worker_id,
        attempts = attempts + 1,
        updated_at = now()
    WHERE id IN (
        SELECT id
        FROM sbt_mint_jobs
        WHERE status IN ('PENDING', 'FAILED')
          AND attempts < 5
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;
