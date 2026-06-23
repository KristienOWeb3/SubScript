-- Merchant-defined subscription plans (named tiers users can pick / upgrade to in DMs).
-- A plan is (amount_usdc, period_seconds); the on-chain subscription is created from these.
-- RLS default-deny; only the service role (app) touches this table.

CREATE TABLE IF NOT EXISTS merchant_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    name TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CHECK (amount_usdc > 0),
    period_seconds BIGINT NOT NULL CHECK (period_seconds > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_plans_merchant_address_idx ON merchant_plans(merchant_address);

ALTER TABLE merchant_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on merchant_plans" ON merchant_plans;
CREATE POLICY "Deny all public access on merchant_plans" ON merchant_plans FOR ALL USING (false);
