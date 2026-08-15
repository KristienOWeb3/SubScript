/* Merchant dashboard overview attribution and time-series indexes. */
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS plan_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_id_fkey'
    ) THEN
        ALTER TABLE public.subscriptions
            ADD CONSTRAINT subscriptions_plan_id_fkey
            FOREIGN KEY (plan_id) REFERENCES public.merchant_plans(id)
            ON DELETE SET NULL;
    END IF;
END $$;

UPDATE public.subscriptions s
SET plan_id = p.id
FROM public.merchant_plans p
WHERE s.plan_id IS NULL
  AND s.kind = 'CUSTOMER'
  AND s.source_checkout_id IS NOT NULL
  AND p.merchant_address = s.merchant_address
  AND p.source_checkout_id = s.source_checkout_id;

WITH candidates AS (
    SELECT
        s.contract_address,
        s.subscription_id,
        MIN(p.id::text)::uuid AS plan_id,
        COUNT(*) AS candidate_count
    FROM public.subscriptions s
    JOIN public.merchant_plans p
      ON p.merchant_address = s.merchant_address
     AND p.amount_usdc = s.amount_cap_usdc::numeric
     AND p.period_seconds = s.billing_interval_seconds
    WHERE s.plan_id IS NULL
      AND s.kind = 'CUSTOMER'
    GROUP BY s.contract_address, s.subscription_id
)
UPDATE public.subscriptions s
SET plan_id = c.plan_id
FROM candidates c
WHERE s.contract_address = c.contract_address
  AND s.subscription_id = c.subscription_id
  AND c.candidate_count = 1;

CREATE INDEX IF NOT EXISTS subscriptions_merchant_plan_active_idx
    ON public.subscriptions (merchant_address, plan_id, status, cancel_at_period_end, downgrade_failures)
    WHERE kind = 'CUSTOMER' AND plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchant_events_dashboard_revenue_idx
    ON public.merchant_events (merchant_address, environment, occurred_at)
    WHERE event_type IN ('payment.succeeded', 'subscription.activated', 'subscription.renewed');

CREATE INDEX IF NOT EXISTS receipts_dashboard_confirmed_idx
    ON public.receipts (merchant_address, confirmed_at)
    WHERE status = 'CONFIRMED';