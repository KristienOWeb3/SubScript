-- Payroll execution is leased without moving the schedule forward. Transaction
-- hashes are persisted as soon as they are broadcast so a later keeper run can
-- recover an ambiguous result without pulling the merchant's funds twice.
ALTER TABLE public.payroll_campaigns
    ADD COLUMN IF NOT EXISTS processing_claim_id UUID,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_execution_payday TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_pull_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS last_payout_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS last_execution_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS last_execution_status TEXT,
    ADD COLUMN IF NOT EXISTS last_execution_error TEXT;

CREATE INDEX IF NOT EXISTS idx_payroll_campaigns_due_lease
    ON public.payroll_campaigns (status, next_payday, processing_started_at);

-- Recompute the merchant balance cache under one transaction and row lock.
-- The old implementation acquired a lock in one Data API request, released it,
-- then read and updated in later requests, allowing stale totals to win.
CREATE OR REPLACE FUNCTION public.repair_merchant_balance_atomic(p_wallet_address TEXT)
RETURNS TABLE (
    available_balance_usdc BIGINT,
    reserved_balance_usdc BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_merchant_address TEXT;
BEGIN
    SELECT merchant.wallet_address
      INTO v_merchant_address
      FROM public.merchants AS merchant
     WHERE lower(merchant.wallet_address) = lower(p_wallet_address)
     FOR UPDATE;

    IF v_merchant_address IS NULL THEN
        RAISE EXCEPTION 'Merchant not found';
    END IF;

    RETURN QUERY
    WITH totals AS (
        SELECT
            COALESCE(sum(entry.amount_usdc) FILTER (
                WHERE entry.entry_type IN ('CREDIT_PAYMENT', 'CREDIT_PAYMENT_LINK')
                  AND entry.status = 'FINALIZED'
            ), 0)::BIGINT AS credits,
            COALESCE(sum(entry.amount_usdc) FILTER (
                WHERE entry.entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT')
                  AND entry.status = 'FINALIZED'
            ), 0)::BIGINT AS finalized_debits,
            COALESCE(sum(entry.amount_usdc) FILTER (
                WHERE entry.entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT', 'RESERVE')
                  AND entry.status = 'PENDING'
            ), 0)::BIGINT AS pending_debits
        FROM public.ledger_entries AS entry
        WHERE entry.merchant_address = decode(substring(v_merchant_address FROM 3), 'hex')
          AND entry.status <> 'FAILED'
    ), updated AS (
        UPDATE public.merchants AS merchant
           SET available_balance_usdc = greatest(
                   totals.credits - totals.finalized_debits - totals.pending_debits,
                   0
               ),
               reserved_balance_usdc = greatest(totals.pending_debits, 0),
               updated_at = now()
          FROM totals
         WHERE merchant.wallet_address = v_merchant_address
        RETURNING merchant.available_balance_usdc, merchant.reserved_balance_usdc
    )
    SELECT updated.available_balance_usdc, updated.reserved_balance_usdc
      FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_merchant_balance_atomic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_merchant_balance_atomic(TEXT) TO service_role;
