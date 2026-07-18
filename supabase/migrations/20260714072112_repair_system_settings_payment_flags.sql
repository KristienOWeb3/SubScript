-- Production was baselined with the payment-link migration recorded even though
-- these independent circuit breakers were absent from public.system_settings.
-- Keep this repair additive and idempotent so existing settings are preserved.
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS hosted_payments_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS batch_payouts_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS sbt_minting_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS webhook_dispatch_enabled BOOLEAN NOT NULL DEFAULT true;
