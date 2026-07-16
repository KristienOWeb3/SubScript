/* Expired checkout attempts were reaped only for the payer who happened to be asking.
 *
 * reserve_payment_link_checkout_attempt increments payment_links.use_count to hold capacity, and
 * gives the hold back when an attempt expires without ever binding a transaction. But the reaper
 * filtered on `lower(payer_address) = lower(p_payer_address)`, while use_count is a property of the
 * LINK, not of a payer. So an abandoned attempt from payer A kept holding A's slot against everyone
 * else, and only A returning could ever give it back. On a max_uses = 1 link, one payer opening a
 * checkout and walking away made the link read LINK_UNAVAILABLE ("This link cannot accept a payment
 * right now") for every other payer until A came back — which A never does.
 *
 * The reaper now releases any attempt on this link that provably never bound a transaction and whose
 * TTL has passed, regardless of who reserved it. Capacity is the link's, so its accounting is too.
 *
 * Concurrency: the advisory lock here is scoped per (link, payer), so two payers reserving on the
 * same link run concurrently and can now reach the same expired row. That is safe without widening
 * the lock: SELECT ... FOR UPDATE blocks the second reaper, and on unblock READ COMMITTED
 * re-evaluates the WHERE against the committed row, which by then reads status = 'RELEASED' and
 * drops out — so a hold is never handed back twice. ORDER BY attempt_id gives every reaper the same
 * lock order, so overlapping reaps queue instead of deadlocking. Capacity itself was already safe:
 * the conditional `use_count < max_uses` UPDATE below takes a row lock on payment_links and is
 * atomic, so only one of two racing payers can win the last use.
 *
 * Everything else in this function is byte-for-byte the definition from
 * supabase/migrations/20260715093000_checkout_receipt_integrity.sql; only the reaper's payer filter
 * is dropped and the ORDER BY added.
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

    /* Release every attempt on this link that provably never bound a transaction — not just this
       payer's. The hold belongs to the link, so any payer's expired hold must come back.
       Bounded, because reaping another payer's holds makes the batch unbounded in a way the
       payer-scoped version never was: concurrent RESERVED attempts can only exceed max_uses when
       max_uses IS NULL, and on such a link (no capacity to run out of) stale holds accumulate with
       traffic, so one reservation after a long idle could lock and update every one of them in a
       single transaction. The cap keeps lock hold and contention flat. It costs nothing in
       correctness: this runs before the capacity check below, and a link sitting at max_uses needs
       only ONE hold back to admit the caller, so successive calls converge on a clean count. */
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
