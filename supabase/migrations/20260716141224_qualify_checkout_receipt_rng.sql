/*
 * reserve_payment_link_checkout_attempt runs with an empty search_path, but pgcrypto is installed
 * in Supabase's extensions schema. The unqualified gen_random_bytes call therefore failed at
 * runtime before a checkout receipt could be created. Preserve the complete live reservation
 * contract and schema-qualify the receipt RNG.
 */
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

    v_receipt_id := 'rcpt-' || encode(extensions.gen_random_bytes(16), 'hex');
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

REVOKE EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payment_link_checkout_attempt(UUID, UUID, TEXT, INTEGER)
    TO service_role, postgres;
