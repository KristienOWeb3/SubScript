/* A hosted checkout must be able to drive its own durable verification job before
   the request returns. The batch keeper remains the crash-recovery fallback, while
   this targeted claim prevents a busy queue from making a payer wait for unrelated
   settlements. The same lease rules keep concurrent retries idempotent. */
CREATE OR REPLACE FUNCTION public.claim_payment_link_verification_job_by_tx_hash(
    p_tx_hash TEXT,
    p_claim_token UUID,
    p_lease_seconds INTEGER DEFAULT 150
)
RETURNS SETOF public.payment_link_verification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'payment-link verification claim token is required';
    END IF;
    IF p_tx_hash IS NULL OR btrim(p_tx_hash) !~ '^0x[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'valid payment-link verification transaction hash is required';
    END IF;

    RETURN QUERY
    WITH candidate AS (
        SELECT job.id
        FROM public.payment_link_verification_jobs AS job
        WHERE job.tx_hash = lower(btrim(p_tx_hash))
          AND (
              (job.status IN ('PENDING', 'RETRY') AND job.next_attempt_at <= now())
              OR (job.status = 'PROCESSING' AND job.lease_expires_at <= now())
          )
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE public.payment_link_verification_jobs AS job
    SET status = 'PROCESSING',
        attempts = job.attempts + 1,
        lease_token = p_claim_token,
        lease_expires_at = now() + make_interval(
            secs => greatest(30, least(COALESCE(p_lease_seconds, 150), 300))
        ),
        updated_at = now()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_payment_link_verification_job_by_tx_hash(TEXT, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_verification_job_by_tx_hash(TEXT, UUID, INTEGER)
    TO service_role, postgres;
