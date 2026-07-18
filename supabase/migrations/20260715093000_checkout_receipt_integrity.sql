/*
 * Checkout attempt integrity.
 *
 * A checkout attempt is the durable boundary between reviewing a payment and
 * broadcasting it. It owns capacity and immutable settlement terms before a
 * wallet can move funds; a transaction hash can only bind an existing attempt.
 */

ALTER TABLE public.payment_links
    ADD COLUMN IF NOT EXISTS link_kind TEXT NOT NULL DEFAULT 'MERCHANT',
    ADD COLUMN IF NOT EXISTS sandbox_mode BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS creation_fingerprint JSONB,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE public.payment_links
SET link_kind = 'PEER_REQUEST'
WHERE merchant_name_snapshot = 'SubScript user request'
   OR external_reference LIKE 'peer-request:%'
   OR external_reference LIKE 'dm-peer-request:%';

ALTER TABLE public.payment_links
    DROP CONSTRAINT IF EXISTS payment_links_link_kind_check;
ALTER TABLE public.payment_links
    ADD CONSTRAINT payment_links_link_kind_check
    CHECK (link_kind IN ('MERCHANT', 'PEER_REQUEST'));

CREATE TABLE IF NOT EXISTS public.payment_link_checkout_attempts (
    attempt_id UUID PRIMARY KEY,
    payment_link_id UUID NOT NULL REFERENCES public.payment_links(id) ON DELETE RESTRICT,
    payer_address TEXT NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE,
    link_kind TEXT NOT NULL CHECK (link_kind IN ('MERCHANT', 'PEER_REQUEST')),
    sandbox_mode BOOLEAN NOT NULL,
    merchant_address_snapshot TEXT NOT NULL,
    beneficiary_address_snapshot TEXT NOT NULL,
    amount_usdc_snapshot BIGINT NOT NULL CHECK (amount_usdc_snapshot > 0),
    title_snapshot TEXT NOT NULL,
    external_reference_snapshot TEXT,
    merchant_name_snapshot TEXT,
    tx_hash TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'RESERVED'
        CHECK (status IN ('RESERVED', 'SUBMITTED', 'SETTLED', 'RELEASED')),
    expires_at TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_link_checkout_attempts_payer_format
        CHECK (payer_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT payment_link_checkout_attempts_receipt_format
        CHECK (receipt_id ~ '^rcpt-[0-9a-f]{32}$'),
    CONSTRAINT payment_link_checkout_attempts_tx_format
        CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_link_checkout_attempts_one_active
    ON public.payment_link_checkout_attempts (payment_link_id, lower(payer_address))
    WHERE status IN ('RESERVED', 'SUBMITTED');
CREATE INDEX IF NOT EXISTS payment_link_checkout_attempts_expiry_idx
    ON public.payment_link_checkout_attempts (expires_at)
    WHERE status = 'RESERVED' AND tx_hash IS NULL;

ALTER TABLE public.payment_link_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_link_checkout_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_link_checkout_attempts TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.prevent_payment_link_settlement_term_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.link_kind IS DISTINCT FROM OLD.link_kind
       OR NEW.sandbox_mode IS DISTINCT FROM OLD.sandbox_mode
       OR NEW.merchant_address IS DISTINCT FROM OLD.merchant_address
       OR NEW.amount_usdc IS DISTINCT FROM OLD.amount_usdc
       OR NEW.beneficiary_address IS DISTINCT FROM OLD.beneficiary_address
       OR NEW.receipt_token IS DISTINCT FROM OLD.receipt_token
       OR NEW.creation_fingerprint IS DISTINCT FROM OLD.creation_fingerprint THEN
        RAISE EXCEPTION 'payment link settlement terms are immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_link_immutable_settlement_terms ON public.payment_links;
CREATE TRIGGER payment_link_immutable_settlement_terms
    BEFORE UPDATE ON public.payment_links
    FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_link_settlement_term_change();

/* Serialize quota checks for every insertion path, including future routes. */
CREATE OR REPLACE FUNCTION public.enforce_payment_link_quota()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_tier TEXT;
    v_limit INTEGER;
    v_count INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(lower(NEW.merchant_address), 7201));
    SELECT tier INTO v_tier
    FROM public.merchants
    WHERE lower(wallet_address) = lower(NEW.merchant_address);
    v_limit := CASE WHEN COALESCE(v_tier, 'FREE') = 'PREMIUM' THEN 10000 ELSE 100 END;
    SELECT count(*) INTO v_count
    FROM public.payment_links
    WHERE lower(merchant_address) = lower(NEW.merchant_address)
      AND active = true
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > now());
    IF v_count >= v_limit THEN
        RAISE EXCEPTION 'payment link quota exceeded' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_links_enforce_quota ON public.payment_links;
CREATE TRIGGER payment_links_enforce_quota
    BEFORE INSERT ON public.payment_links
    FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_link_quota();

CREATE OR REPLACE FUNCTION public.reserve_payment_link_checkout_attempt(
    p_attempt_id UUID,
    p_payment_link_id UUID,
    p_payer_address TEXT,
    p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_link public.payment_links%ROWTYPE;
    v_attempt public.payment_link_checkout_attempts%ROWTYPE;
    v_receipt_id TEXT;
    v_hosted_enabled BOOLEAN;
    v_expired RECORD;
BEGIN
    IF p_attempt_id IS NULL OR p_payer_address !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'invalid checkout attempt parameters';
    END IF;
    IF p_ttl_seconds < 120 OR p_ttl_seconds > 1800 THEN
        RAISE EXCEPTION 'checkout attempt ttl is out of bounds';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_payment_link_id::text || ':' || lower(p_payer_address), 7202));

    /* Release only attempts that provably never bound a transaction. */
    FOR v_expired IN
        SELECT attempt_id, payment_link_id
        FROM public.payment_link_checkout_attempts
        WHERE payment_link_id = p_payment_link_id
          AND lower(payer_address) = lower(p_payer_address)
          AND status = 'RESERVED'
          AND tx_hash IS NULL
          AND expires_at <= now()
        FOR UPDATE
    LOOP
        UPDATE public.payment_link_checkout_attempts
        SET status = 'RELEASED', updated_at = now()
        WHERE attempt_id = v_expired.attempt_id;
        UPDATE public.payment_links
        SET use_count = greatest(use_count - 1, 0)
        WHERE id = v_expired.payment_link_id;
    END LOOP;

    SELECT hosted_payments_enabled INTO v_hosted_enabled
    FROM public.system_settings
    LIMIT 1;
    IF v_hosted_enabled IS FALSE THEN
        RETURN jsonb_build_object('outcome', 'DISABLED');
    END IF;

    SELECT * INTO v_attempt
    FROM public.payment_link_checkout_attempts
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;
    IF FOUND THEN
        IF v_attempt.payment_link_id IS DISTINCT FROM p_payment_link_id
           OR lower(v_attempt.payer_address) IS DISTINCT FROM lower(p_payer_address) THEN
            RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
        END IF;
        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_attempt.status = 'SETTLED' THEN 'SETTLED' ELSE 'RESERVED' END,
            'receiptId', v_attempt.receipt_id,
            'amountUsdc', v_attempt.amount_usdc_snapshot::text,
            'merchantAddress', v_attempt.merchant_address_snapshot,
            'linkKind', v_attempt.link_kind,
            'sandbox', v_attempt.sandbox_mode,
            'txHash', v_attempt.tx_hash
        );
    END IF;

    SELECT * INTO v_attempt
    FROM public.payment_link_checkout_attempts
    WHERE payment_link_id = p_payment_link_id
      AND lower(payer_address) = lower(p_payer_address)
      AND status IN ('RESERVED', 'SUBMITTED')
    LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('outcome', 'IN_PROGRESS');
    END IF;

    UPDATE public.payment_links
    SET use_count = use_count + 1
    WHERE id = p_payment_link_id
      AND active = true
      AND deleted_at IS NULL
      AND sandbox_mode = false
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR use_count < max_uses)
    RETURNING * INTO v_link;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'LINK_UNAVAILABLE');
    END IF;
    IF lower(v_link.merchant_address) = lower(p_payer_address) THEN
        RAISE EXCEPTION 'payer cannot pay its own link';
    END IF;

    v_receipt_id := 'rcpt-' || encode(gen_random_bytes(16), 'hex');
    INSERT INTO public.payment_link_checkout_attempts (
        attempt_id, payment_link_id, payer_address, receipt_id, link_kind,
        sandbox_mode, merchant_address_snapshot, beneficiary_address_snapshot,
        amount_usdc_snapshot, title_snapshot, external_reference_snapshot,
        merchant_name_snapshot, expires_at
    ) VALUES (
        p_attempt_id, p_payment_link_id, lower(p_payer_address), v_receipt_id,
        v_link.link_kind, v_link.sandbox_mode, lower(v_link.merchant_address),
        lower(COALESCE(NULLIF(v_link.beneficiary_address, ''), p_payer_address)),
        v_link.amount_usdc, v_link.title, v_link.external_reference,
        v_link.merchant_name_snapshot, now() + make_interval(secs => p_ttl_seconds)
    ) RETURNING * INTO v_attempt;

    RETURN jsonb_build_object(
        'outcome', 'RESERVED',
        'receiptId', v_attempt.receipt_id,
        'amountUsdc', v_attempt.amount_usdc_snapshot::text,
        'merchantAddress', v_attempt.merchant_address_snapshot,
        'linkKind', v_attempt.link_kind,
        'sandbox', v_attempt.sandbox_mode
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_payment_link_checkout_attempt(
    p_attempt_id UUID,
    p_payer_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_attempt public.payment_link_checkout_attempts%ROWTYPE;
BEGIN
    SELECT * INTO v_attempt FROM public.payment_link_checkout_attempts
    WHERE attempt_id = p_attempt_id AND lower(payer_address) = lower(p_payer_address)
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'MISSING'); END IF;
    IF v_attempt.tx_hash IS NOT NULL OR v_attempt.status <> 'RESERVED' THEN
        RETURN jsonb_build_object('outcome', 'RETAINED');
    END IF;
    UPDATE public.payment_link_checkout_attempts
    SET status = 'RELEASED', updated_at = now()
    WHERE attempt_id = p_attempt_id;
    UPDATE public.payment_links
    SET use_count = greatest(use_count - 1, 0)
    WHERE id = v_attempt.payment_link_id;
    RETURN jsonb_build_object('outcome', 'RELEASED');
END;
$$;

/* A hash can enqueue verification only by binding an existing reservation. */
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
    v_attempt public.payment_link_checkout_attempts%ROWTYPE;
    v_existing public.idempotency_keys%ROWTYPE;
    v_verification public.transaction_verifications%ROWTYPE;
    v_fingerprint JSONB;
    v_job public.payment_link_verification_jobs%ROWTYPE;
BEGIN
    IF p_execution_key IS DISTINCT FROM 'verify-payment-link:' || lower(p_tx_hash) THEN
        RAISE EXCEPTION 'payment settlement execution key does not match transaction';
    END IF;
    SELECT * INTO v_attempt
    FROM public.payment_link_checkout_attempts
    WHERE attempt_id = p_checkout_attempt_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_attempt.payment_link_id IS DISTINCT FROM p_payment_link_id
       OR lower(v_attempt.payer_address) IS DISTINCT FROM lower(p_payer_address)
       OR v_attempt.receipt_id IS DISTINCT FROM p_receipt_id THEN
        RETURN jsonb_build_object('outcome', 'ATTEMPT_NOT_FOUND', 'error', 'checkout attempt reservation not found');
    END IF;
    IF v_attempt.status = 'RELEASED' THEN
        RETURN jsonb_build_object('outcome', 'LINK_UNAVAILABLE');
    END IF;
    IF v_attempt.tx_hash IS NOT NULL AND lower(v_attempt.tx_hash) IS DISTINCT FROM lower(p_tx_hash) THEN
        RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
    END IF;
    IF v_attempt.sandbox_mode THEN
        RETURN jsonb_build_object('outcome', 'LINK_UNAVAILABLE');
    END IF;
    SELECT * INTO v_verification FROM public.transaction_verifications
    WHERE tx_hash = lower(p_tx_hash);
    IF FOUND AND (
        v_verification.reference_type <> 'PAYMENT_LINK'
        OR v_verification.reference_id <> p_payment_link_id::text
    ) THEN
        RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
    END IF;

    v_fingerprint := jsonb_build_object(
        'txHash', lower(p_tx_hash), 'chainId', p_chain_id,
        'paymentLinkId', p_payment_link_id::text,
        'payerAddress', lower(p_payer_address), 'receiptId', p_receipt_id,
        'ledgerRequired', p_create_ledger
    );

    INSERT INTO public.idempotency_keys (
        execution_key, status, expires_at, request_fingerprint, reservation_active
    ) VALUES (p_execution_key, 'PROCESSING', p_expires_at, v_fingerprint, true)
    ON CONFLICT (execution_key) DO NOTHING;

    SELECT * INTO v_existing FROM public.idempotency_keys
    WHERE execution_key = p_execution_key FOR UPDATE;
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
    END IF;
    IF v_existing.status = 'COMPLETED' THEN
        RETURN jsonb_build_object('outcome', 'COMPLETED', 'responsePayload', v_existing.response_payload);
    END IF;

    UPDATE public.payment_link_checkout_attempts
    SET tx_hash = lower(p_tx_hash), status = 'SUBMITTED', submitted_at = COALESCE(submitted_at, now()), updated_at = now()
    WHERE attempt_id = p_checkout_attempt_id;

    INSERT INTO public.transaction_verifications (
        tx_hash, status, reference_type, reference_id, confirmations, updated_at
    ) VALUES (lower(p_tx_hash), 'SUBMITTED', 'PAYMENT_LINK', p_payment_link_id::text, 0, now())
    ON CONFLICT (tx_hash) DO UPDATE SET updated_at = now()
    WHERE public.transaction_verifications.reference_type = 'PAYMENT_LINK'
      AND public.transaction_verifications.reference_id = p_payment_link_id::text;

    IF p_create_ledger THEN
        INSERT INTO public.ledger_entries (
            merchant_address, entry_type, status, amount_usdc, reference_type, reference_id, tx_hash
        ) VALUES (
            decode(substring(v_attempt.merchant_address_snapshot from 3), 'hex'),
            'CREDIT_PAYMENT_LINK', 'PENDING', v_attempt.amount_usdc_snapshot,
            'PAYMENT_LINK', p_payment_link_id::text, lower(p_tx_hash)
        ) ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.payment_link_verification_jobs (
        execution_key, tx_hash, chain_id, payment_link_id, payer_address,
        receipt_id, merchant_address, beneficiary_address, amount_usdc,
        settles_directly_to_user, payment_title, external_reference,
        merchant_name_snapshot, checkout_attempt_id, request_origin,
        status, attempts, next_attempt_at, updated_at
    ) VALUES (
        p_execution_key, lower(p_tx_hash), p_chain_id, p_payment_link_id,
        lower(p_payer_address), p_receipt_id, v_attempt.merchant_address_snapshot,
        v_attempt.beneficiary_address_snapshot, v_attempt.amount_usdc_snapshot,
        v_attempt.link_kind = 'PEER_REQUEST', v_attempt.title_snapshot,
        v_attempt.external_reference_snapshot, v_attempt.merchant_name_snapshot,
        p_checkout_attempt_id, left(p_request_origin, 2048), 'PENDING', 0, now(), now()
    ) ON CONFLICT (execution_key) DO UPDATE
    SET checkout_attempt_id = EXCLUDED.checkout_attempt_id,
        request_origin = COALESCE(public.payment_link_verification_jobs.request_origin, EXCLUDED.request_origin),
        updated_at = now()
    RETURNING * INTO v_job;

    RETURN jsonb_build_object('outcome', CASE WHEN v_job.attempts = 0 THEN 'CLAIMED' ELSE 'IN_PROGRESS' END,
        'requestFingerprint', v_fingerprint, 'verificationJob', to_jsonb(v_job));
END;
$$;

/* Durable checkout-specific post-settlement work. */
CREATE TABLE IF NOT EXISTS public.payment_link_settlement_effects (
    payment_link_payment_id UUID PRIMARY KEY REFERENCES public.payment_link_payments(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_link_settlement_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_link_settlement_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_link_settlement_effects TO service_role, postgres;

/* The existing finalizer updates this row last. This trigger runs in that same
   transaction, so CONFIRMED receipts and the durable effects record cannot
   become visible unless payment/ledger settlement also commits. */
CREATE OR REPLACE FUNCTION public.persist_confirmed_checkout_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment public.payment_link_payments%ROWTYPE;
    v_existing public.receipts%ROWTYPE;
    v_receipt_id TEXT;
    v_chain_id INTEGER;
    v_link_kind TEXT;
    v_attempt public.payment_link_checkout_attempts%ROWTYPE;
BEGIN
    IF NEW.status <> 'COMPLETED' OR OLD.status = 'COMPLETED'
       OR NEW.execution_key NOT LIKE 'verify-payment-link:%' THEN
        RETURN NEW;
    END IF;
    v_receipt_id := NEW.request_fingerprint ->> 'receiptId';
    v_chain_id := (NEW.request_fingerprint ->> 'chainId')::integer;
    SELECT * INTO v_payment FROM public.payment_link_payments
    WHERE id = (NEW.response_payload ->> 'paymentId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'settled payment missing for receipt'; END IF;
    SELECT * INTO v_attempt FROM public.payment_link_checkout_attempts
    WHERE tx_hash = lower(v_payment.tx_hash);
    IF NOT FOUND THEN RAISE EXCEPTION 'settled checkout attempt missing for receipt'; END IF;
    v_link_kind := v_attempt.link_kind;

    SELECT * INTO v_existing FROM public.receipts WHERE receipt_id = v_receipt_id FOR UPDATE;
    IF FOUND AND (
        lower(v_existing.tx_hash) IS DISTINCT FROM lower(v_payment.tx_hash)
        OR v_existing.payment_link_id IS DISTINCT FROM v_payment.payment_link_id
        OR v_existing.amount_usdc IS DISTINCT FROM v_payment.amount_usdc
        OR lower(v_existing.payer_address) IS DISTINCT FROM lower(v_payment.payer_address)
    ) THEN
        RAISE EXCEPTION 'existing receipt does not match settlement';
    END IF;
    IF NOT FOUND THEN
        INSERT INTO public.receipts (
            receipt_id, payment_link_id, payment_link_payment_id, tx_hash, chain_id,
            memo_contract, payer_address, beneficiary_address, merchant_address,
            amount_usdc, memo_note, share_url, status, block_number, confirmed_at, updated_at
        ) VALUES (
            v_receipt_id, v_payment.payment_link_id, v_payment.id, lower(v_payment.tx_hash), v_chain_id,
            lower(NEW.response_payload ->> 'memoContract'),
            lower(v_payment.payer_address), lower(COALESCE(v_payment.beneficiary_address, v_payment.payer_address)),
            lower(v_payment.merchant_address), v_payment.amount_usdc, v_receipt_id,
            COALESCE(NEW.response_payload ->> 'shareUrl', '/receipt/' || v_receipt_id),
            'CONFIRMED', v_payment.verification_block, now(), now()
        );
    END IF;

    INSERT INTO public.payment_link_settlement_effects (payment_link_payment_id)
    VALUES (v_payment.id) ON CONFLICT DO NOTHING;
    UPDATE public.payment_link_checkout_attempts
    SET status = 'SETTLED', settled_at = now(), updated_at = now()
    WHERE attempt_id = v_attempt.attempt_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS idempotency_persist_confirmed_checkout_receipt ON public.idempotency_keys;
CREATE TRIGGER idempotency_persist_confirmed_checkout_receipt
    AFTER UPDATE OF status ON public.idempotency_keys
    FOR EACH ROW EXECUTE FUNCTION public.persist_confirmed_checkout_receipt();

/* Provider/indexing outages are not proof of payment failure. Keep submitted attempts queued
   indefinitely with capped backoff; only deterministic verification failures release capacity. */
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
    IF p_claim_token IS NULL THEN RAISE EXCEPTION 'payment-link verification claim token is required'; END IF;
    RETURN QUERY
    WITH candidates AS (
        SELECT job.id FROM public.payment_link_verification_jobs AS job
        WHERE (job.status IN ('PENDING', 'RETRY') AND job.next_attempt_at <= now())
           OR (job.status = 'PROCESSING' AND job.lease_expires_at <= now())
        ORDER BY job.next_attempt_at, job.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(COALESCE(p_batch_size, 1), 25))
    )
    UPDATE public.payment_link_verification_jobs AS job
    SET status = 'PROCESSING', attempts = job.attempts + 1,
        lease_token = p_claim_token,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(COALESCE(p_lease_seconds, 150), 300))),
        updated_at = now()
    FROM candidates WHERE job.id = candidates.id
    RETURNING job.*;
END;
$$;

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
    SELECT * INTO v_job FROM public.payment_link_verification_jobs
    WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'MISSING'); END IF;
    IF v_job.status IN ('COMPLETED', 'FAILED') THEN
        RETURN jsonb_build_object('outcome', v_job.status);
    END IF;
    IF v_job.status <> 'PROCESSING' OR v_job.lease_token IS DISTINCT FROM p_claim_token THEN
        RETURN jsonb_build_object('outcome', 'LEASE_MISMATCH');
    END IF;

    IF p_terminal THEN
        v_release := public.release_payment_link_settlement(
            v_job.execution_key, v_job.tx_hash, v_job.chain_id,
            v_job.payment_link_id, v_job.payer_address, v_job.receipt_id,
            left(COALESCE(p_error_message, 'Payment verification failed'), 2000)
        );
        UPDATE public.payment_link_checkout_attempts
        SET status = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'SETTLED' ELSE 'RELEASED' END,
            updated_at = now()
        WHERE attempt_id = v_job.checkout_attempt_id;
        UPDATE public.payment_link_verification_jobs
        SET status = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'COMPLETED' ELSE 'FAILED' END,
            lease_token = NULL, lease_expires_at = NULL,
            last_error = left(p_error_message, 2000),
            completed_at = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN now() ELSE NULL END,
            updated_at = now()
        WHERE id = v_job.id;
        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'COMPLETED' ELSE 'FAILED' END,
            'releaseOutcome', v_release ->> 'outcome'
        );
    END IF;

    v_delay_seconds := CASE
        WHEN v_job.attempts <= 1 THEN 15
        WHEN v_job.attempts = 2 THEN 30
        WHEN v_job.attempts = 3 THEN 60
        WHEN v_job.attempts = 4 THEN 120
        ELSE 300
    END;
    UPDATE public.payment_link_verification_jobs
    SET status = 'RETRY',
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        lease_token = NULL, lease_expires_at = NULL,
        last_error = left(p_error_message, 2000), updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('outcome', 'RETRY', 'retryAfterSeconds', v_delay_seconds);
END;
$$;

/* Preserve financial history when a link is archived. */
ALTER TABLE public.payment_link_payments
    DROP CONSTRAINT IF EXISTS payment_link_payments_payment_link_id_fkey;
ALTER TABLE public.payment_link_payments
    ADD CONSTRAINT payment_link_payments_payment_link_id_fkey
    FOREIGN KEY (payment_link_id) REFERENCES public.payment_links(id) ON DELETE RESTRICT;

REVOKE EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.release_payment_link_checkout_attempt(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_payment_link_checkout_attempt(UUID, TEXT)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.persist_confirmed_checkout_receipt() FROM PUBLIC, anon, authenticated;
