ALTER TABLE public.payment_link_payments
    ADD COLUMN IF NOT EXISTS checkout_attempt_id UUID;

CREATE INDEX IF NOT EXISTS payment_link_payments_checkout_attempt_idx
    ON public.payment_link_payments (payment_link_id, checkout_attempt_id, created_at DESC)
    WHERE checkout_attempt_id IS NOT NULL;
