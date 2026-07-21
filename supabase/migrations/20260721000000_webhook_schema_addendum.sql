/*
 * Schema addendum: webhook/event tables and columns added after
 * 20260719183000_expand_schemas.sql was deployed to production.
 *
 * Implements:
 * 1. Additional webhook_endpoints columns (environment, encryption rotation, etc.).
 * 2. merchant_events table (event-sourced outbox for webhook dispatch).
 * 3. webhook_deliveries expansion columns.
 * 4. webhook_delivery_attempts table (individual retry tracking).
 * 5. Conditional _subscript_migrations ledger expansion (safe for E2E).
 */

-- 1. Additional Webhook Endpoints Columns
ALTER TABLE public.webhook_endpoints
    ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'TEST',
    ADD COLUMN IF NOT EXISTS enabled_events TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS api_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS description TEXT NULL,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS previous_ciphertext TEXT NULL,
    ADD COLUMN IF NOT EXISTS previous_nonce TEXT NULL,
    ADD COLUMN IF NOT EXISTS previous_authentication_tag TEXT NULL,
    ADD COLUMN IF NOT EXISTS previous_key_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS previous_secret_expires_at TIMESTAMPTZ NULL;

-- 2. Merchant Events (event-sourced outbox for webhook dispatch)
CREATE TABLE IF NOT EXISTS public.merchant_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    merchant_address TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'TEST',
    api_version TEXT NOT NULL,
    event_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_version INT NOT NULL,
    sequence_number INT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    effective_at TIMESTAMPTZ NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_events_wallet_env_idx ON public.merchant_events (merchant_address, environment);
CREATE INDEX IF NOT EXISTS merchant_events_resource_seq_idx ON public.merchant_events (resource_type, resource_id, sequence_number);
CREATE INDEX IF NOT EXISTS merchant_events_wallet_created_idx ON public.merchant_events (merchant_address, created_at);
CREATE INDEX IF NOT EXISTS merchant_events_type_idx ON public.merchant_events (event_type);

ALTER TABLE public.merchant_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_events TO service_role, postgres;

-- 3. Webhook Deliveries expansion (missing columns)
ALTER TABLE public.webhook_deliveries
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS http_status INT NULL;

-- 4. Webhook Delivery Attempts (individual retry tracking)
CREATE TABLE IF NOT EXISTS public.webhook_delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_delivery_id UUID NOT NULL REFERENCES public.webhook_deliveries(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    http_status INT,
    response_body TEXT,
    error_message TEXT,
    duration_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_attempts_delivery_idx ON public.webhook_delivery_attempts (webhook_delivery_id);

ALTER TABLE public.webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhook_delivery_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_delivery_attempts TO service_role, postgres;

-- 5. Migration Ledger expansion for Checksum Integrity
-- The _subscript_migrations table is created by scripts/apply-migrations.mjs (prod runner).
-- Supabase's native runner (supabase db reset / E2E) doesn't create it — skip gracefully.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_subscript_migrations') THEN
        ALTER TABLE public._subscript_migrations
            ADD COLUMN IF NOT EXISTS sha256 TEXT NULL,
            ADD COLUMN IF NOT EXISTS byte_length INT NULL,
            ADD COLUMN IF NOT EXISTS application_commit TEXT NULL,
            ADD COLUMN IF NOT EXISTS runner_version TEXT NULL;
    END IF;
END $$;
