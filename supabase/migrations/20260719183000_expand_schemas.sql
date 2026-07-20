/*
 * Schema expansion migration for Findings 25-66.
 *
 * Implements:
 * 1. public.get_public_payment_link(uuid) security-definer function.
 * 2. Revoking public base-table access on public.payment_links.
 * 3. public.auth_identities table for stable identity binding.
 * 4. closure_status column additions for account deactivation state machine.
 * 5. public.subscription_attempts table for tracking subscription lifecycles.
 * 6. public.spending_limit_operations and public.spending_limit_reservations tables.
 * 7. public.batch_send_operations and public.batch_send_items tables.
 * 8. Webhook endpoints soft-delete and encryption support.
 * 9. _subscript_migrations expansion for checksum integrity.
 */

-- 1. Payment Links Base-Table Safety & RPC Isolation
DROP POLICY IF EXISTS "Public select active payment links" ON public.payment_links;

REVOKE ALL ON TABLE public.payment_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_links TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.get_public_payment_link(p_link_id uuid)
RETURNS TABLE (
    id uuid,
    merchant_address text,
    title text,
    description text,
    amount_usdc bigint,
    expires_at timestamptz,
    beneficiary_address text,
    link_kind text,
    sandbox_mode boolean,
    settlement_chain_id bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        link.id,
        link.merchant_address,
        link.title,
        link.description,
        link.amount_usdc,
        link.expires_at,
        link.beneficiary_address,
        link.link_kind,
        link.sandbox_mode,
        link.settlement_chain_id::bigint
    FROM public.payment_links AS link
    WHERE link.id = p_link_id
      AND link.active = true
      AND link.deleted_at IS NULL
      AND link.simulation_only = false
      AND (link.expires_at IS NULL OR link.expires_at > statement_timestamp())
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_payment_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_payment_link(uuid) TO anon, authenticated, service_role;

-- 2. Stable Authentication Identities
CREATE TABLE IF NOT EXISTS public.auth_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    current_email text,
    wallet_address text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_verified_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, issuer, subject)
);

CREATE INDEX IF NOT EXISTS auth_identities_wallet_address_idx
    ON public.auth_identities (wallet_address);

ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_identities TO service_role, postgres;

-- 3. Profile Closure State Columns
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS closure_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (closure_status IN ('OPEN', 'CLOSURE_REQUESTED', 'REVOCATION_IN_PROGRESS', 'READY_TO_ANONYMIZE', 'CLOSED', 'CLOSURE_FAILED'));
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS closure_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (closure_status IN ('OPEN', 'CLOSURE_REQUESTED', 'REVOCATION_IN_PROGRESS', 'READY_TO_ANONYMIZE', 'CLOSED', 'CLOSURE_FAILED'));

-- 4. Subscription Attempts Lifecycle
CREATE TABLE IF NOT EXISTS public.subscription_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    subscriber_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    provider_idempotency_key TEXT NOT NULL,
    promotion_claim_id UUID,
    status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'SUBMISSION_STARTED', 'SUBMISSION_UNKNOWN', 'CHAIN_CONFIRMED', 'COMPLETED', 'PROVEN_NOT_SUBMITTED', 'FAILED_TERMINAL')),
    lease_token TEXT,
    lease_expires_at TIMESTAMPTZ,
    provider_operation_id TEXT,
    tx_hash TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT subscription_attempts_merchant_key UNIQUE (merchant_address, idempotency_key)
);

CREATE INDEX IF NOT EXISTS subscription_attempts_subscriber_idx ON public.subscription_attempts (subscriber_address);
CREATE INDEX IF NOT EXISTS subscription_attempts_lease_idx ON public.subscription_attempts (lease_token) WHERE lease_token IS NOT NULL;

ALTER TABLE public.subscription_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscription_attempts TO service_role, postgres;

-- 5. Spending Limit Operations and Reservations
CREATE TABLE IF NOT EXISTS public.spending_limit_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CHECK (amount_usdc > 0),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('DIRECT_SEND', 'BATCH_SEND', 'SUB_FIRST_PAY', 'SUB_RECURRING', 'VAULT_COMMIT', 'CCTP_TRANSFER', 'PAYROLL', 'REFUND_REVERSAL')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FINALIZED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.spending_limit_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.spending_limit_operations(id) ON DELETE CASCADE,
    user_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CHECK (amount_usdc > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.spending_limit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spending_limit_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spending_limit_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.spending_limit_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spending_limit_operations TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spending_limit_reservations TO service_role, postgres;

-- 6. Batch Payout Operations and Items
CREATE TABLE IF NOT EXISTS public.batch_send_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    total_amount_usdc BIGINT NOT NULL CHECK (total_amount_usdc >= 0),
    item_count INTEGER NOT NULL CHECK (item_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT batch_send_operations_key UNIQUE (merchant_address, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.batch_send_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.batch_send_operations(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    original_position INTEGER NOT NULL CHECK (original_position >= 0),
    recipient TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CHECK (amount_usdc > 0),
    request_fingerprint TEXT NOT NULL,
    provider_idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'SUBMISSION_STARTED', 'SUBMISSION_UNKNOWN', 'CONFIRMED', 'PROVEN_NOT_SUBMITTED', 'FAILED_TERMINAL')),
    provider_operation_id TEXT,
    tx_hash TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT batch_send_items_op_item UNIQUE (operation_id, item_id)
);

ALTER TABLE public.batch_send_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_send_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.batch_send_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.batch_send_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_send_operations TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_send_items TO service_role, postgres;

-- 7. Webhook Endpoints Encryption & Environment Columns
ALTER TABLE public.webhook_endpoints
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS url_hash TEXT NULL,
    ADD COLUMN IF NOT EXISTS ciphertext TEXT NULL,
    ADD COLUMN IF NOT EXISTS nonce TEXT NULL,
    ADD COLUMN IF NOT EXISTS authentication_tag TEXT NULL,
    ADD COLUMN IF NOT EXISTS key_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS encryption_algorithm TEXT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS webhook_endpoints_wallet_url_active_idx
ON public.webhook_endpoints (wallet_address, url_hash)
WHERE deleted_at IS NULL;

-- 8. Migration Ledger expansion for Checksum Integrity
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
