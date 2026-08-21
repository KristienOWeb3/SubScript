-- Give receipts a human subject line.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `public.receipts` recorded who paid, who was paid, how much, and when, but never WHAT the
-- payment was for. The receipt page had nothing else to lead with, so its <h1> was
-- `receipt_id` — "rcpt-" followed by 32 hex characters. The same string appeared a second
-- time further down the page, because persist_confirmed_checkout_receipt writes
-- `memo_note := v_receipt_id` (the on-chain memo IS the receipt id), and the page rendered
-- `memo_note || receipt_id`.
--
-- The fact was already in the database at settlement time. Every checkout snapshots its
-- title into `payment_link_checkout_attempts.title_snapshot`, and the trigger below already
-- reads that row for other fields. It just never carried the title across.
--
-- WHAT CHANGES
-- ------------
--   1. `receipts.title` — nullable TEXT. The subject of the receipt.
--   2. persist_confirmed_checkout_receipt now copies title_snapshot into it. This is the
--      only path that creates a receipt inside the settlement transaction; the two
--      application-side inserts (the /verify repair path and the Arc Memo indexer) are
--      updated in the same change.
--   3. A backfill for rows that can be resolved from their payment link. Rows with no
--      payment_link_id are left NULL rather than given an invented subject — a receipt that
--      records no title should read as having none, not as having a guessed one.
--
-- WHY NULLABLE AND NOT `NOT NULL DEFAULT ''`
-- ------------------------------------------
-- An empty string is a title, and the page would have to special-case it anyway. NULL says
-- "no recorded subject", which is the state the fallback chain (title -> memo_note ->
-- "Payment to <merchant>") is written against.
--
-- The receipt id itself is untouched: it is the memo string passed to depositForMerchant and
-- it appears inside idempotency keys. This migration changes what a receipt SAYS, not what
-- it IS.

ALTER TABLE public.receipts
    ADD COLUMN IF NOT EXISTS title TEXT;

/* Unchanged from 20260715093000_checkout_receipt_integrity.sql apart from the two title
   lines in the INSERT. The original comment on the trigger still holds and is reproduced
   here so the definition remains self-explanatory in isolation:

   The existing finalizer updates this row last. This trigger runs in that same
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
            amount_usdc, title, memo_note, share_url, status, block_number, confirmed_at, updated_at
        ) VALUES (
            v_receipt_id, v_payment.payment_link_id, v_payment.id, lower(v_payment.tx_hash), v_chain_id,
            lower(NEW.response_payload ->> 'memoContract'),
            lower(v_payment.payer_address), lower(COALESCE(v_payment.beneficiary_address, v_payment.payer_address)),
            lower(v_payment.merchant_address), v_payment.amount_usdc,
            nullif(btrim(v_attempt.title_snapshot), ''), v_receipt_id,
            COALESCE(NEW.response_payload ->> 'shareUrl', '/receipt/' || v_receipt_id),
            'CONFIRMED', v_payment.verification_block, now(), now()
        );
    ELSIF v_existing.title IS NULL THEN
        /* The repair inserts can land first and, on old code paths, without a title. Filling
           it here keeps the settlement transaction the single authority on the subject line
           without touching any field that identifies the payment. */
        UPDATE public.receipts
        SET title = nullif(btrim(v_attempt.title_snapshot), ''), updated_at = now()
        WHERE receipt_id = v_receipt_id;
    END IF;

    INSERT INTO public.payment_link_settlement_effects (payment_link_payment_id)
    VALUES (v_payment.id) ON CONFLICT DO NOTHING;
    UPDATE public.payment_link_checkout_attempts
    SET status = 'SETTLED', settled_at = now(), updated_at = now()
    WHERE attempt_id = v_attempt.attempt_id;
    RETURN NEW;
END;
$$;

/* Backfill, in two passes, most specific first.
   The checkout attempt is the better source: it is the title as the payer saw it at the
   moment of payment, and it survives a later edit to the link. The link's current title is
   the fallback for rows whose attempt row has since been reaped. */
UPDATE public.receipts AS r
SET title = nullif(btrim(a.title_snapshot), '')
FROM public.payment_link_checkout_attempts AS a
WHERE r.title IS NULL
  AND a.tx_hash = lower(r.tx_hash)
  AND nullif(btrim(a.title_snapshot), '') IS NOT NULL;

UPDATE public.receipts AS r
SET title = nullif(btrim(l.title), '')
FROM public.payment_links AS l
WHERE r.title IS NULL
  AND r.payment_link_id = l.id
  AND nullif(btrim(l.title), '') IS NOT NULL;
