-- Scope payment-link idempotency keys per merchant (audit medium: keys were globally unique, so
-- one merchant using another merchant's key string would collide). Replace the global unique on
-- idempotency_key with a composite unique on (merchant_address, idempotency_key). Existing keys are
-- preserved. Idempotent.

alter table public.payment_links drop constraint if exists payment_links_idempotency_key_key;
drop index if exists public.payment_links_idempotency_key_key;

-- Composite unique: NULL idempotency_key rows remain unconstrained (Postgres treats NULLs as
-- distinct), so links without a key are unaffected; two rows for the SAME merchant with the SAME
-- non-null key are rejected, across different merchants they no longer collide.
create unique index if not exists payment_links_merchant_idempotency_key
    on public.payment_links (merchant_address, idempotency_key);
