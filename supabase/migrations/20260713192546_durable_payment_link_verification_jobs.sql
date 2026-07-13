/*
 * Durable outbox for hosted payment-link verification. The request-side claim
 * and job insert share one database transaction; leased workers never keep a
 * database transaction open while querying the chain or delivering side effects.
 */

/* The production table may already exist when this migration was applied
   out-of-band before the repository ledger recorded it. Keep creation safe to
   replay, then validate the columns required by the worker before continuing. */
CREATE TABLE IF NOT EXISTS public.payment_link_verification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_key TEXT NOT NULL UNIQUE,
    tx_hash TEXT NOT NULL UNIQUE,
    chain_id BIGINT NOT NULL,
    payment_link_id UUID NOT NULL,
    payer_address TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    merchant_address TEXT NOT NULL,
    beneficiary_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CHECK (amount_usdc > 0),
    settles_directly_to_user BOOLEAN NOT NULL,
    payment_title TEXT NOT NULL,
    external_reference TEXT,
    merchant_name_snapshot TEXT,
    checkout_attempt_id UUID,
    request_origin TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_link_verification_jobs_execution_key_matches_tx
        CHECK (execution_key = 'verify-payment-link:' || lower(tx_hash)),
    CONSTRAINT payment_link_verification_jobs_tx_hash_format
        CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT payment_link_verification_jobs_payer_format
        CHECK (payer_address ~ '^0x[0-9a-f]{40}$')
);

DO $$
DECLARE
    v_missing_columns TEXT;
BEGIN
    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
    INTO v_missing_columns
    FROM (VALUES
        ('id'),
        ('execution_key'),
        ('tx_hash'),
        ('chain_id'),
        ('payment_link_id'),
        ('payer_address'),
        ('receipt_id'),
        ('merchant_address'),
        ('beneficiary_address'),
        ('amount_usdc'),
        ('settles_directly_to_user'),
        ('payment_title'),
        ('external_reference'),
        ('merchant_name_snapshot'),
        ('checkout_attempt_id'),
        ('request_origin'),
        ('status'),
        ('attempts'),
        ('max_attempts'),
        ('next_attempt_at'),
        ('lease_token'),
        ('lease_expires_at'),
        ('last_error'),
        ('completed_at'),
        ('created_at'),
        ('updated_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns AS existing
        WHERE existing.table_schema = 'public'
          AND existing.table_name = 'payment_link_verification_jobs'
          AND existing.column_name = required.column_name
    );

    IF v_missing_columns IS NOT NULL THEN
        RAISE EXCEPTION
            'Existing payment_link_verification_jobs table is incompatible; missing columns: %',
            v_missing_columns;
    END IF;
END;
$$;

ALTER TABLE public.payment_link_verification_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_link_verification_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_link_verification_jobs TO service_role;

/* Reassert uniqueness for an existing out-of-band table. The names match the
   indexes PostgreSQL creates for the inline UNIQUE declarations above. */
CREATE UNIQUE INDEX IF NOT EXISTS payment_link_verification_jobs_execution_key_key
    ON public.payment_link_verification_jobs (execution_key);

CREATE UNIQUE INDEX IF NOT EXISTS payment_link_verification_jobs_tx_hash_key
    ON public.payment_link_verification_jobs (tx_hash);

CREATE INDEX IF NOT EXISTS payment_link_verification_jobs_ready_idx
    ON public.payment_link_verification_jobs (next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'RETRY');

CREATE INDEX IF NOT EXISTS payment_link_verification_jobs_expired_lease_idx
    ON public.payment_link_verification_jobs (lease_expires_at, created_at)
    WHERE status = 'PROCESSING';

/* Wrap the existing atomic capacity claim so its successful reservation and
   outbox row either both commit or both roll back. The checkout attempt lives
   on the durable row because the final payment row does not exist yet. */
CREATE OR REPLACE FUNCTION public.claim_payment_link_settlement_durable(
    p_execution_key TEXT,
    p_tx_hash TEXT,
    p_chain_id BIGINT,
    p_payment_link_id UUID,
    p_payer_address TEXT,
    p_receipt_id TEXT,
    p_expires_at TIMESTAMPTZ,
    p_create_ledger BOOLEAN,
    p_checkout_attempt_id UUID,
    p_request_origin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
    v_job public.payment_link_verification_jobs%ROWTYPE;
    v_link public.payment_links%ROWTYPE;
BEGIN
    v_result := public.claim_payment_link_settlement(
        p_execution_key,
        p_tx_hash,
        p_chain_id,
        p_payment_link_id,
        p_payer_address,
        p_receipt_id,
        p_expires_at,
        p_create_ledger
    );

    IF v_result ->> 'outcome' IN ('CLAIMED', 'IN_PROGRESS') THEN
        SELECT * INTO v_link
        FROM public.payment_links
        WHERE id = p_payment_link_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'payment link disappeared after settlement claim';
        END IF;
    END IF;

    IF v_result ->> 'outcome' = 'CLAIMED' THEN
        INSERT INTO public.payment_link_verification_jobs (
            execution_key,
            tx_hash,
            chain_id,
            payment_link_id,
            payer_address,
            receipt_id,
            merchant_address,
            beneficiary_address,
            amount_usdc,
            settles_directly_to_user,
            payment_title,
            external_reference,
            merchant_name_snapshot,
            checkout_attempt_id,
            request_origin,
            status,
            attempts,
            next_attempt_at,
            lease_token,
            lease_expires_at,
            last_error,
            completed_at,
            updated_at
        ) VALUES (
            p_execution_key,
            lower(p_tx_hash),
            p_chain_id,
            p_payment_link_id,
            lower(p_payer_address),
            p_receipt_id,
            lower(v_link.merchant_address),
            lower(COALESCE(NULLIF(v_link.beneficiary_address, ''), p_payer_address)),
            v_link.amount_usdc,
            COALESCE(v_link.merchant_name_snapshot, '') = 'SubScript user request'
                OR COALESCE(v_link.external_reference, '') LIKE 'peer-request:%'
                OR COALESCE(v_link.external_reference, '') LIKE 'dm-peer-request:%',
            v_link.title,
            v_link.external_reference,
            v_link.merchant_name_snapshot,
            p_checkout_attempt_id,
            left(p_request_origin, 2048),
            'PENDING',
            0,
            now(),
            NULL,
            NULL,
            NULL,
            NULL,
            now()
        )
        ON CONFLICT (execution_key) DO UPDATE
        SET chain_id = EXCLUDED.chain_id,
            payment_link_id = EXCLUDED.payment_link_id,
            payer_address = EXCLUDED.payer_address,
            receipt_id = EXCLUDED.receipt_id,
            merchant_address = EXCLUDED.merchant_address,
            beneficiary_address = EXCLUDED.beneficiary_address,
            amount_usdc = EXCLUDED.amount_usdc,
            settles_directly_to_user = EXCLUDED.settles_directly_to_user,
            payment_title = EXCLUDED.payment_title,
            external_reference = EXCLUDED.external_reference,
            merchant_name_snapshot = EXCLUDED.merchant_name_snapshot,
            checkout_attempt_id = EXCLUDED.checkout_attempt_id,
            request_origin = EXCLUDED.request_origin,
            status = 'PENDING',
            attempts = 0,
            next_attempt_at = now(),
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL,
            completed_at = NULL,
            updated_at = now()
        RETURNING * INTO v_job;
    ELSIF v_result ->> 'outcome' = 'IN_PROGRESS' THEN
        /* Heal claims created before this migration, or a rare earlier request
           whose response died before its worker was scheduled. */
        INSERT INTO public.payment_link_verification_jobs (
            execution_key,
            tx_hash,
            chain_id,
            payment_link_id,
            payer_address,
            receipt_id,
            merchant_address,
            beneficiary_address,
            amount_usdc,
            settles_directly_to_user,
            payment_title,
            external_reference,
            merchant_name_snapshot,
            checkout_attempt_id,
            request_origin
        ) VALUES (
            p_execution_key,
            lower(p_tx_hash),
            p_chain_id,
            p_payment_link_id,
            lower(p_payer_address),
            p_receipt_id,
            lower(v_link.merchant_address),
            lower(COALESCE(NULLIF(v_link.beneficiary_address, ''), p_payer_address)),
            v_link.amount_usdc,
            COALESCE(v_link.merchant_name_snapshot, '') = 'SubScript user request'
                OR COALESCE(v_link.external_reference, '') LIKE 'peer-request:%'
                OR COALESCE(v_link.external_reference, '') LIKE 'dm-peer-request:%',
            v_link.title,
            v_link.external_reference,
            v_link.merchant_name_snapshot,
            p_checkout_attempt_id,
            left(p_request_origin, 2048)
        )
        ON CONFLICT (execution_key) DO UPDATE
        SET checkout_attempt_id = COALESCE(public.payment_link_verification_jobs.checkout_attempt_id, EXCLUDED.checkout_attempt_id),
            request_origin = COALESCE(public.payment_link_verification_jobs.request_origin, EXCLUDED.request_origin),
            updated_at = now()
        RETURNING * INTO v_job;
    END IF;

    IF v_job.id IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('verificationJob', to_jsonb(v_job));
    END IF;

    RETURN v_result;
END;
$$;

/* Claim ready work in one short transaction. Expired leases are reclaimable;
   SKIP LOCKED lets multiple keepers drain the queue without duplicate work. */
CREATE OR REPLACE FUNCTION public.claim_payment_link_verification_jobs(
    p_batch_size INTEGER,
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

    RETURN QUERY
    WITH candidates AS (
        SELECT job.id
        FROM public.payment_link_verification_jobs AS job
        WHERE (
            job.status IN ('PENDING', 'RETRY')
            AND job.next_attempt_at <= now()
            AND job.attempts < job.max_attempts
        ) OR (
            job.status = 'PROCESSING'
            AND job.lease_expires_at <= now()
        )
        ORDER BY job.next_attempt_at, job.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(COALESCE(p_batch_size, 1), 25))
    )
    UPDATE public.payment_link_verification_jobs AS job
    SET status = 'PROCESSING',
        attempts = job.attempts + 1,
        lease_token = p_claim_token,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(COALESCE(p_lease_seconds, 150), 300))),
        updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_payment_link_verification_job(
    p_job_id UUID,
    p_claim_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.payment_link_verification_jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job
    FROM public.payment_link_verification_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'MISSING');
    END IF;
    IF v_job.status = 'COMPLETED' THEN
        RETURN jsonb_build_object('outcome', 'COMPLETED');
    END IF;
    IF v_job.status <> 'PROCESSING' OR v_job.lease_token IS DISTINCT FROM p_claim_token THEN
        RETURN jsonb_build_object('outcome', 'LEASE_MISMATCH');
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.payment_link_payments AS payment
        WHERE lower(payment.tx_hash) = lower(v_job.tx_hash)
          AND payment.payment_link_id = v_job.payment_link_id
    ) THEN
        RETURN jsonb_build_object('outcome', 'SETTLEMENT_MISSING');
    END IF;

    UPDATE public.payment_link_verification_jobs
    SET status = 'COMPLETED',
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        completed_at = now(),
        updated_at = now()
    WHERE id = v_job.id;

    RETURN jsonb_build_object('outcome', 'COMPLETED');
END;
$$;

/* Retry with bounded exponential backoff. Terminal/exhausted work releases the
   reserved payment-link use in the same transaction that marks the job failed. */
CREATE OR REPLACE FUNCTION public.reschedule_payment_link_verification_job(
    p_job_id UUID,
    p_claim_token UUID,
    p_error_message TEXT,
    p_terminal BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.payment_link_verification_jobs%ROWTYPE;
    v_release JSONB;
    v_delay_seconds INTEGER;
BEGIN
    SELECT * INTO v_job
    FROM public.payment_link_verification_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'MISSING');
    END IF;
    IF v_job.status IN ('COMPLETED', 'FAILED') THEN
        RETURN jsonb_build_object('outcome', v_job.status);
    END IF;
    IF v_job.status <> 'PROCESSING' OR v_job.lease_token IS DISTINCT FROM p_claim_token THEN
        RETURN jsonb_build_object('outcome', 'LEASE_MISMATCH');
    END IF;

    IF p_terminal OR v_job.attempts >= v_job.max_attempts THEN
        v_release := public.release_payment_link_settlement(
            v_job.execution_key,
            v_job.tx_hash,
            v_job.chain_id,
            v_job.payment_link_id,
            v_job.payer_address,
            v_job.receipt_id,
            left(COALESCE(p_error_message, 'Payment verification failed'), 2000)
        );

        UPDATE public.payment_link_verification_jobs
        SET status = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'COMPLETED' ELSE 'FAILED' END,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = left(p_error_message, 2000),
            completed_at = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN now() ELSE NULL END,
            updated_at = now()
        WHERE id = v_job.id;

        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'COMPLETED' ELSE 'FAILED' END,
            'releaseOutcome', v_release ->> 'outcome'
        );
    END IF;

    v_delay_seconds := CASE v_job.attempts
        WHEN 1 THEN 15
        WHEN 2 THEN 30
        WHEN 3 THEN 60
        WHEN 4 THEN 120
        ELSE 300
    END;

    UPDATE public.payment_link_verification_jobs
    SET status = 'RETRY',
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = left(p_error_message, 2000),
        updated_at = now()
    WHERE id = v_job.id;

    RETURN jsonb_build_object('outcome', 'RETRY', 'retryAfterSeconds', v_delay_seconds);
END;
$$;

/* Backfill any reservation that was already active when this migration landed.
   A retried verification request can fill in its checkout-attempt correlation. */
INSERT INTO public.payment_link_verification_jobs (
    execution_key,
    tx_hash,
    chain_id,
    payment_link_id,
    payer_address,
    receipt_id,
    merchant_address,
    beneficiary_address,
    amount_usdc,
    settles_directly_to_user,
    payment_title,
    external_reference,
    merchant_name_snapshot
)
SELECT
    claim.execution_key,
    lower(claim.request_fingerprint ->> 'txHash'),
    (claim.request_fingerprint ->> 'chainId')::BIGINT,
    (claim.request_fingerprint ->> 'paymentLinkId')::UUID,
    lower(claim.request_fingerprint ->> 'payerAddress'),
    claim.request_fingerprint ->> 'receiptId',
    lower(link.merchant_address),
    lower(COALESCE(NULLIF(link.beneficiary_address, ''), claim.request_fingerprint ->> 'payerAddress')),
    link.amount_usdc,
    COALESCE(link.merchant_name_snapshot, '') = 'SubScript user request'
        OR COALESCE(link.external_reference, '') LIKE 'peer-request:%'
        OR COALESCE(link.external_reference, '') LIKE 'dm-peer-request:%',
    link.title,
    link.external_reference,
    link.merchant_name_snapshot
FROM public.idempotency_keys AS claim
JOIN public.payment_links AS link
  ON link.id = (claim.request_fingerprint ->> 'paymentLinkId')::UUID
WHERE claim.status = 'PROCESSING'
  AND claim.reservation_active = true
  AND claim.execution_key LIKE 'verify-payment-link:%'
  AND claim.request_fingerprint IS NOT NULL
ON CONFLICT (execution_key) DO NOTHING;

REVOKE EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.claim_payment_link_verification_jobs(INTEGER, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_verification_jobs(INTEGER, UUID, INTEGER)
    TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.complete_payment_link_verification_job(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_link_verification_job(UUID, UUID)
    TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.reschedule_payment_link_verification_job(UUID, UUID, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_payment_link_verification_job(UUID, UUID, TEXT, BOOLEAN)
    TO service_role, postgres;
