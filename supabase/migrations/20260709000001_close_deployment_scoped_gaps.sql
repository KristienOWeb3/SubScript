/* Close the deployment-scoped product gaps for the public beta (2026-07-08).
   Idempotent, additive-only. Ships: plan commitment windows, per-merchant dunning
   config, invoice fields on payment links, sponsored-subscription beneficiary,
   and sandbox test clocks. The signup-free demo key is seeded separately by
   scripts/seed-demo-key.mjs (it needs the app's key-hashing). */

/* 1. Commitment windows: merchants may require a minimum commitment before an
   immediate cancel is allowed (early cancels convert to cancel-at-period-end).
   Protocol ceiling: 30 days (2592000s); digital-goods guidance is 72h. */
ALTER TABLE merchant_plans
    ADD COLUMN IF NOT EXISTS min_commitment_seconds BIGINT NOT NULL DEFAULT 0;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'merchant_plans_min_commitment_ceiling'
    ) THEN
        ALTER TABLE merchant_plans
            ADD CONSTRAINT merchant_plans_min_commitment_ceiling
            CHECK (min_commitment_seconds >= 0 AND min_commitment_seconds <= 2592000);
    END IF;
END $$;

/* The subscription mirror snapshots the window at subscribe time so cancellation
   enforcement never needs a fragile plan join. NULL = no commitment. */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS min_commitment_until TIMESTAMPTZ DEFAULT NULL;

/* 2. Sponsored subscriptions ("Pay for Me") v1: the paying wallet (subscriber)
   may differ from the wallet that receives the service. Merchants key
   entitlements off the beneficiary carried in webhooks. */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS beneficiary_address TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_beneficiary_address_idx
    ON subscriptions (beneficiary_address);

/* 3. Configurable dunning: how many failed renewal attempts before the keeper
   stops the subscription (zombie kill). Default preserves current behavior. */
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS dunning_max_failures INT NOT NULL DEFAULT 4;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'merchants_dunning_max_failures_range'
    ) THEN
        ALTER TABLE merchants
            ADD CONSTRAINT merchants_dunning_max_failures_range
            CHECK (dunning_max_failures >= 1 AND dunning_max_failures <= 10);
    END IF;
END $$;

/* 4. Invoice fields on payment links (invoice engine v1): number, due date, and
   payer identity ride on the existing link/receipt/webhook lifecycle. */
ALTER TABLE payment_links
    ADD COLUMN IF NOT EXISTS invoice_number TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS payer_email TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS payment_links_invoice_number_idx
    ON payment_links (merchant_address, invoice_number)
    WHERE invoice_number IS NOT NULL;

/* 5. Sandbox test clocks: simulate the recurring-billing pipeline (webhooks +
   event ledger) without waiting real time or touching the chain. Test keys only. */
CREATE TABLE IF NOT EXISTS test_clocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'test clock',
    frozen_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_clocks_merchant_idx ON test_clocks (merchant_address);

CREATE TABLE IF NOT EXISTS test_clock_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clock_id UUID NOT NULL REFERENCES test_clocks(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'test subscription',
    amount_usdc_micros BIGINT NOT NULL,
    interval_seconds BIGINT NOT NULL CHECK (interval_seconds > 0),
    subscriber_label TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000t35',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_renewed_at TIMESTAMPTZ,
    renewals_fired INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_clock_subscriptions_clock_idx ON test_clock_subscriptions (clock_id);

ALTER TABLE test_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_clock_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'test_clocks' AND policyname = 'Deny all public access on test_clocks') THEN
        CREATE POLICY "Deny all public access on test_clocks" ON test_clocks FOR ALL USING (false) WITH CHECK (false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'test_clock_subscriptions' AND policyname = 'Deny all public access on test_clock_subscriptions') THEN
        CREATE POLICY "Deny all public access on test_clock_subscriptions" ON test_clock_subscriptions FOR ALL USING (false) WITH CHECK (false);
    END IF;
END $$;
