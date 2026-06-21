/* Fix Supabase advisor warnings before launch.
   - Pin function search_path to avoid role-mutable lookup behavior.
   - Add indexes for foreign keys reported as unindexed.
   - Drop the duplicate receipt_token index, keeping the unique constraint index. */

ALTER FUNCTION public.lock_merchant_row(TEXT)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.update_subscription_next_billing_date()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.update_updated_at_column()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.claim_pending_payment_sessions(INT)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.activate_premium_merchant(TEXT, BIGINT, UUID, TEXT, NUMERIC, BIGINT)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.compact_event_log()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.prevent_account_email_reuse()
    SET search_path = public, pg_temp;

CREATE INDEX IF NOT EXISTS cli_sessions_merchant_address_idx
    ON public.cli_sessions(merchant_address);

CREATE INDEX IF NOT EXISTS payout_batch_items_chunk_id_idx
    ON public.payout_batch_items(chunk_id);

DROP INDEX IF EXISTS public.payment_links_receipt_token_idx;
