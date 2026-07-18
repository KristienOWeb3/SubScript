/*
 * Keep a hosted payment-link settlement's claim, capacity reservation, ledger
 * credit, and terminal state transitions inside database transactions. The
 * functions are intentionally service-role-only: callers supply public
 * checkout data, but only the trusted verification route may mutate balances.
 */

ALTER TABLE public.idempotency_keys
    ADD COLUMN IF NOT EXISTS request_fingerprint JSONB,
    ADD COLUMN IF NOT EXISTS reservation_active BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.webhook_deliveries
    ADD COLUMN IF NOT EXISTS event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_endpoint_event_unique
    ON public.webhook_deliveries (webhook_endpoint_id, event_id)
    WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_idempotency_fingerprint_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF OLD.request_fingerprint IS NOT NULL
       AND NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
        RAISE EXCEPTION 'idempotency request fingerprint is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS idempotency_keys_immutable_fingerprint
    ON public.idempotency_keys;
CREATE TRIGGER idempotency_keys_immutable_fingerprint
    BEFORE UPDATE OF request_fingerprint ON public.idempotency_keys
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_idempotency_fingerprint_change();

/* A transaction may create at most one payment-link credit in every state. */
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_payment_link_credit_tx_unique
    ON public.ledger_entries (lower(tx_hash))
    WHERE entry_type = 'CREDIT_PAYMENT_LINK' AND tx_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_payment_link_settlement(
    p_execution_key TEXT,
    p_tx_hash TEXT,
    p_chain_id BIGINT,
    p_payment_link_id UUID,
    p_payer_address TEXT,
    p_receipt_id TEXT,
    p_expires_at TIMESTAMPTZ,
    p_create_ledger BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_fingerprint JSONB;
    v_inserted_id UUID;
    v_existing public.idempotency_keys%ROWTYPE;
    v_verification public.transaction_verifications%ROWTYPE;
    v_merchant_address TEXT;
    v_amount_usdc BIGINT;
BEGIN
    IF p_execution_key IS DISTINCT FROM 'verify-payment-link:' || lower(p_tx_hash) THEN
        RAISE EXCEPTION 'payment settlement execution key does not match transaction';
    END IF;

    v_fingerprint := jsonb_build_object(
        'txHash', lower(p_tx_hash),
        'chainId', p_chain_id,
        'paymentLinkId', p_payment_link_id::text,
        'payerAddress', lower(p_payer_address),
        'receiptId', p_receipt_id,
        'ledgerRequired', p_create_ledger
    );

    INSERT INTO public.idempotency_keys (
        execution_key,
        status,
        response_payload,
        expires_at,
        request_fingerprint,
        reservation_active
    ) VALUES (
        p_execution_key,
        'PROCESSING',
        NULL,
        p_expires_at,
        v_fingerprint,
        false
    )
    ON CONFLICT (execution_key) DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
        SELECT * INTO v_existing
        FROM public.idempotency_keys
        WHERE execution_key = p_execution_key;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('outcome', 'RETRY');
        END IF;
        IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
        END IF;
        IF v_existing.status = 'COMPLETED' THEN
            RETURN jsonb_build_object(
                'outcome', 'COMPLETED',
                'responsePayload', v_existing.response_payload
            );
        END IF;
        RETURN jsonb_build_object('outcome', 'IN_PROGRESS');
    END IF;

    SELECT * INTO v_verification
    FROM public.transaction_verifications
    WHERE tx_hash = lower(p_tx_hash);

    IF FOUND AND (
        v_verification.reference_type <> 'PAYMENT_LINK'
        OR v_verification.reference_id <> p_payment_link_id::text
    ) THEN
        DELETE FROM public.idempotency_keys WHERE id = v_inserted_id;
        RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
    ELSIF FOUND AND v_verification.status <> 'FAILED' THEN
        DELETE FROM public.idempotency_keys WHERE id = v_inserted_id;
        RETURN jsonb_build_object('outcome', 'IN_PROGRESS');
    END IF;

    UPDATE public.payment_links
    SET use_count = use_count + 1
    WHERE id = p_payment_link_id
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR use_count < max_uses)
    RETURNING merchant_address, amount_usdc
    INTO v_merchant_address, v_amount_usdc;

    IF NOT FOUND THEN
        DELETE FROM public.idempotency_keys WHERE id = v_inserted_id;
        RETURN jsonb_build_object('outcome', 'LINK_UNAVAILABLE');
    END IF;

    UPDATE public.idempotency_keys
    SET reservation_active = true
    WHERE id = v_inserted_id;

    INSERT INTO public.transaction_verifications (
        tx_hash,
        status,
        reference_type,
        reference_id,
        confirmations,
        error_message,
        updated_at
    ) VALUES (
        lower(p_tx_hash),
        'SUBMITTED',
        'PAYMENT_LINK',
        p_payment_link_id::text,
        0,
        NULL,
        now()
    )
    ON CONFLICT (tx_hash) DO UPDATE
    SET status = 'SUBMITTED',
        confirmations = 0,
        error_message = NULL,
        updated_at = now()
    WHERE public.transaction_verifications.reference_type = 'PAYMENT_LINK'
      AND public.transaction_verifications.reference_id = p_payment_link_id::text
      AND public.transaction_verifications.status = 'FAILED';

    IF p_create_ledger THEN
        IF v_merchant_address !~* '^0x[0-9a-f]{40}$' THEN
            RAISE EXCEPTION 'payment link has invalid merchant address';
        END IF;

        INSERT INTO public.ledger_entries (
            merchant_address,
            entry_type,
            status,
            amount_usdc,
            reference_type,
            reference_id,
            tx_hash
        ) VALUES (
            decode(substring(lower(v_merchant_address) from 3), 'hex'),
            'CREDIT_PAYMENT_LINK',
            'PENDING',
            v_amount_usdc,
            'PAYMENT_LINK',
            p_payment_link_id::text,
            lower(p_tx_hash)
        );
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'CLAIMED',
        'requestFingerprint', v_fingerprint
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_payment_link_settlement(
    p_execution_key TEXT,
    p_tx_hash TEXT,
    p_chain_id BIGINT,
    p_payment_link_id UUID,
    p_payer_address TEXT,
    p_receipt_id TEXT,
    p_beneficiary_address TEXT,
    p_verification_block BIGINT,
    p_settlement_reference TEXT,
    p_response_payload JSONB,
    p_webhook_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claim public.idempotency_keys%ROWTYPE;
    v_link public.payment_links%ROWTYPE;
    v_payment public.payment_link_payments%ROWTYPE;
    v_expected_fingerprint JSONB;
    v_response JSONB;
    v_ledger_required BOOLEAN;
    v_webhook_event_id TEXT;
BEGIN
    IF p_execution_key IS DISTINCT FROM 'verify-payment-link:' || lower(p_tx_hash) THEN
        RAISE EXCEPTION 'payment settlement execution key does not match transaction';
    END IF;

    SELECT * INTO v_claim
    FROM public.idempotency_keys
    WHERE execution_key = p_execution_key
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment settlement claim not found';
    END IF;

    v_ledger_required := COALESCE((v_claim.request_fingerprint ->> 'ledgerRequired')::boolean, false);
    v_expected_fingerprint := jsonb_build_object(
        'txHash', lower(p_tx_hash),
        'chainId', p_chain_id,
        'paymentLinkId', p_payment_link_id::text,
        'payerAddress', lower(p_payer_address),
        'receiptId', p_receipt_id,
        'ledgerRequired', v_ledger_required
    );

    IF v_claim.request_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
        RAISE EXCEPTION 'payment settlement fingerprint mismatch';
    END IF;
    IF v_claim.status = 'COMPLETED' THEN
        RETURN jsonb_build_object(
            'outcome', 'COMPLETED',
            'responsePayload', v_claim.response_payload
        );
    END IF;
    IF v_claim.status <> 'PROCESSING' OR NOT v_claim.reservation_active THEN
        RAISE EXCEPTION 'payment settlement claim is not active';
    END IF;

    SELECT * INTO v_link
    FROM public.payment_links
    WHERE id = p_payment_link_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment link not found during finalization';
    END IF;

    INSERT INTO public.payment_link_payments (
        payment_link_id,
        payer_address,
        beneficiary_address,
        amount_usdc,
        tx_hash,
        merchant_address,
        credited,
        credited_at,
        verification_block,
        verification_chain_id
    ) VALUES (
        p_payment_link_id,
        lower(p_payer_address),
        lower(p_beneficiary_address),
        v_link.amount_usdc,
        lower(p_tx_hash),
        lower(v_link.merchant_address),
        true,
        now(),
        p_verification_block,
        p_chain_id
    )
    ON CONFLICT (tx_hash) DO NOTHING
    RETURNING * INTO v_payment;

    IF NOT FOUND THEN
        SELECT * INTO v_payment
        FROM public.payment_link_payments
        WHERE tx_hash = lower(p_tx_hash);

        IF NOT FOUND
           OR v_payment.payment_link_id IS DISTINCT FROM p_payment_link_id
           OR lower(v_payment.payer_address) IS DISTINCT FROM lower(p_payer_address)
           OR lower(COALESCE(v_payment.beneficiary_address, '')) IS DISTINCT FROM lower(p_beneficiary_address)
           OR lower(v_payment.merchant_address) IS DISTINCT FROM lower(v_link.merchant_address)
           OR v_payment.amount_usdc IS DISTINCT FROM v_link.amount_usdc
           OR v_payment.verification_chain_id IS DISTINCT FROM p_chain_id THEN
            RAISE EXCEPTION 'existing payment does not match settlement fingerprint';
        END IF;
    END IF;

    UPDATE public.payment_links
    SET status = 'PAID',
        paid_at = now(),
        verified_tx_hash = lower(p_tx_hash),
        settlement_reference = p_settlement_reference
    WHERE id = p_payment_link_id;

    IF v_ledger_required THEN
        UPDATE public.ledger_entries
        SET status = 'FINALIZED'
        WHERE lower(tx_hash) = lower(p_tx_hash)
          AND entry_type = 'CREDIT_PAYMENT_LINK'
          AND reference_type = 'PAYMENT_LINK'
          AND reference_id = p_payment_link_id::text
          AND status = 'PENDING';

        IF NOT FOUND AND NOT EXISTS (
            SELECT 1
            FROM public.ledger_entries
            WHERE lower(tx_hash) = lower(p_tx_hash)
              AND entry_type = 'CREDIT_PAYMENT_LINK'
              AND reference_type = 'PAYMENT_LINK'
              AND reference_id = p_payment_link_id::text
              AND status = 'FINALIZED'
        ) THEN
            RAISE EXCEPTION 'payment settlement ledger credit not found';
        END IF;
    END IF;

    UPDATE public.transaction_verifications
    SET status = 'CONFIRMED',
        error_message = NULL,
        updated_at = now()
    WHERE tx_hash = lower(p_tx_hash)
      AND reference_type = 'PAYMENT_LINK'
      AND reference_id = p_payment_link_id::text;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment transaction verification not found';
    END IF;

    v_response := COALESCE(p_response_payload, '{}'::jsonb)
        || jsonb_build_object('paymentId', v_payment.id);

    /* The outbox is committed in the same transaction as payment finalization. A process crash
       after this point cannot lose fulfillment: a retry can deliver the same deterministic event. */
    IF v_ledger_required AND p_webhook_payload IS NOT NULL THEN
        v_webhook_event_id := 'evt_payment_' || v_payment.id::text;
        INSERT INTO public.webhook_deliveries (
            webhook_endpoint_id,
            event_id,
            event,
            status,
            payload,
            signature_version,
            attempts
        )
        SELECT
            endpoint.id,
            v_webhook_event_id,
            'payment.succeeded',
            'PENDING',
            p_webhook_payload || jsonb_build_object('id', v_webhook_event_id),
            'v1',
            0
        FROM public.webhook_endpoints AS endpoint
        WHERE lower(endpoint.wallet_address) = lower(v_link.merchant_address)
          AND endpoint.active = true
        ON CONFLICT (webhook_endpoint_id, event_id) WHERE event_id IS NOT NULL DO NOTHING;
    END IF;

    UPDATE public.idempotency_keys
    SET status = 'COMPLETED',
        response_payload = v_response,
        reservation_active = false,
        updated_at = now()
    WHERE id = v_claim.id;

    RETURN jsonb_build_object(
        'outcome', 'FINALIZED',
        'responsePayload', v_response
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_payment_link_settlement(
    p_execution_key TEXT,
    p_tx_hash TEXT,
    p_chain_id BIGINT,
    p_payment_link_id UUID,
    p_payer_address TEXT,
    p_receipt_id TEXT,
    p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claim public.idempotency_keys%ROWTYPE;
    v_expected_fingerprint JSONB;
    v_ledger_required BOOLEAN;
BEGIN
    IF p_execution_key IS DISTINCT FROM 'verify-payment-link:' || lower(p_tx_hash) THEN
        RAISE EXCEPTION 'payment settlement execution key does not match transaction';
    END IF;

    SELECT * INTO v_claim
    FROM public.idempotency_keys
    WHERE execution_key = p_execution_key
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'MISSING');
    END IF;

    v_ledger_required := COALESCE((v_claim.request_fingerprint ->> 'ledgerRequired')::boolean, false);
    v_expected_fingerprint := jsonb_build_object(
        'txHash', lower(p_tx_hash),
        'chainId', p_chain_id,
        'paymentLinkId', p_payment_link_id::text,
        'payerAddress', lower(p_payer_address),
        'receiptId', p_receipt_id,
        'ledgerRequired', v_ledger_required
    );

    IF v_claim.request_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
        RETURN jsonb_build_object('outcome', 'FINGERPRINT_MISMATCH');
    END IF;
    IF v_claim.status = 'COMPLETED' OR EXISTS (
        SELECT 1 FROM public.payment_link_payments
        WHERE tx_hash = lower(p_tx_hash)
    ) THEN
        RETURN jsonb_build_object('outcome', 'SETTLED');
    END IF;

    IF v_claim.reservation_active THEN
        UPDATE public.payment_links
        SET use_count = greatest(use_count - 1, 0)
        WHERE id = p_payment_link_id;
    END IF;

    DELETE FROM public.ledger_entries
    WHERE lower(tx_hash) = lower(p_tx_hash)
      AND entry_type = 'CREDIT_PAYMENT_LINK'
      AND reference_type = 'PAYMENT_LINK'
      AND reference_id = p_payment_link_id::text
      AND status = 'PENDING';

    UPDATE public.transaction_verifications
    SET status = 'FAILED',
        error_message = left(p_error_message, 2000),
        updated_at = now()
    WHERE tx_hash = lower(p_tx_hash)
      AND reference_type = 'PAYMENT_LINK'
      AND reference_id = p_payment_link_id::text
      AND status <> 'CONFIRMED';

    DELETE FROM public.idempotency_keys WHERE id = v_claim.id;

    RETURN jsonb_build_object('outcome', 'RELEASED');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_idempotency_fingerprint_change() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB, JSONB)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_payment_link_settlement(TEXT, TEXT, BIGINT, UUID, TEXT, TEXT, TEXT)
    TO service_role;
