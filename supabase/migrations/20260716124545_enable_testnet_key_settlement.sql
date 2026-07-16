/*
 * Test API keys are settlement-enabled on Arc testnet.
 *
 * `sandbox_mode` now identifies test-mode/testnet resources; it is not a
 * no-settlement flag. `simulation_only` is reserved for the shared public demo
 * key. Every checkout snapshots its settlement chain so a test-key intent can
 * never be verified against a mainnet transaction.
 */

ALTER TABLE public.payment_links
    ADD COLUMN IF NOT EXISTS simulation_only BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS settlement_chain_id BIGINT NOT NULL DEFAULT 5042002;

ALTER TABLE public.payment_link_checkout_attempts
    ADD COLUMN IF NOT EXISTS simulation_only BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS settlement_chain_id BIGINT NOT NULL DEFAULT 5042002;

/* Preserve the public documentation demo as non-settling. Existing merchant
   test keys become testnet-settling automatically through the false default. */
UPDATE public.payment_links
SET simulation_only = true
WHERE sandbox_mode = true
  AND lower(merchant_address) = '0xdeb0000000000000000000000000000000000001';

CREATE OR REPLACE FUNCTION public.prevent_payment_link_settlement_term_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.link_kind IS DISTINCT FROM OLD.link_kind
       OR NEW.sandbox_mode IS DISTINCT FROM OLD.sandbox_mode
       OR NEW.simulation_only IS DISTINCT FROM OLD.simulation_only
       OR NEW.settlement_chain_id IS DISTINCT FROM OLD.settlement_chain_id
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

    /* Preserve the link-wide, bounded reaper from the preceding migration. Capacity belongs to
       the link, so any payer's expired unbroadcast hold may be returned before reserving a slot. */
    FOR v_expired IN
        SELECT attempt_id, payment_link_id
        FROM public.payment_link_checkout_attempts
        WHERE payment_link_id = p_payment_link_id
          AND status = 'RESERVED'
          AND tx_hash IS NULL
          AND expires_at <= now()
        ORDER BY attempt_id
        LIMIT 50
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
            'simulationOnly', v_attempt.simulation_only,
            'settlementChainId', v_attempt.settlement_chain_id,
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
      AND simulation_only = false
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
        sandbox_mode, simulation_only, settlement_chain_id,
        merchant_address_snapshot, beneficiary_address_snapshot,
        amount_usdc_snapshot, title_snapshot, external_reference_snapshot,
        merchant_name_snapshot, expires_at
    ) VALUES (
        p_attempt_id, p_payment_link_id, lower(p_payer_address), v_receipt_id,
        v_link.link_kind, v_link.sandbox_mode, v_link.simulation_only,
        v_link.settlement_chain_id, lower(v_link.merchant_address),
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
        'sandbox', v_attempt.sandbox_mode,
        'simulationOnly', v_attempt.simulation_only,
        'settlementChainId', v_attempt.settlement_chain_id
    );
END;
$$;

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
    IF v_attempt.simulation_only THEN
        RETURN jsonb_build_object('outcome', 'LINK_UNAVAILABLE');
    END IF;
    IF v_attempt.settlement_chain_id IS DISTINCT FROM p_chain_id THEN
        RETURN jsonb_build_object(
            'outcome', 'CHAIN_MISMATCH',
            'expectedChainId', v_attempt.settlement_chain_id
        );
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
    SET tx_hash = lower(p_tx_hash), status = 'SUBMITTED',
        submitted_at = COALESCE(submitted_at, now()), updated_at = now()
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

    RETURN jsonb_build_object(
        'outcome', CASE WHEN v_job.attempts = 0 THEN 'CLAIMED' ELSE 'IN_PROGRESS' END,
        'requestFingerprint', v_fingerprint,
        'verificationJob', to_jsonb(v_job)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_settlement_durable(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT)
    TO service_role, postgres;
