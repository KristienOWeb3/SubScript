-- A published site checkout keeps its external identity on the canonical MerchantPlan.
-- Nullable preserves all merchant-created plans; unique makes publication idempotent and
-- concurrency-safe without treating amount/period as a product identity.
ALTER TABLE public.merchant_plans
    ADD COLUMN IF NOT EXISTS source_checkout_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_plans_source_checkout_id_key
    ON public.merchant_plans (source_checkout_id);
