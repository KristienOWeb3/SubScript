-- Merchant analytics must scale with one merchant's result size, never total protocol history.
-- The first two indexes mirror Prisma's representable indexes; the expression/covering indexes
-- are PostgreSQL-specific and intentionally remain migration-managed.
CREATE INDEX IF NOT EXISTS subscriptions_merchant_kind_id_idx
    ON public.subscriptions (merchant_address, kind, subscription_id DESC);

CREATE INDEX IF NOT EXISTS subscriptions_merchant_attention_idx
    ON public.subscriptions (
        merchant_address,
        kind,
        status,
        cancel_at_period_end,
        downgrade_failures,
        subscription_id DESC
    );

CREATE INDEX IF NOT EXISTS subscriptions_customer_activity_idx
    ON public.subscriptions (
        merchant_address,
        (COALESCE(last_settlement_timestamp, created_at)) DESC,
        subscription_id DESC
    )
    WHERE kind = 'CUSTOMER';

CREATE INDEX IF NOT EXISTS subscriptions_customer_renewal_metrics_idx
    ON public.subscriptions (merchant_address, status, cancel_at_period_end, downgrade_failures)
    INCLUDE (amount_cap_usdc, billing_interval_seconds)
    WHERE kind = 'CUSTOMER';
