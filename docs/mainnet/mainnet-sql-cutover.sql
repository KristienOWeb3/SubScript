-- ==============================================================================
-- SubScript Protocol: Production Database Mainnet Cutover Migration
-- File: docs/mainnet/mainnet-sql-cutover.sql
-- Target Database: Dedicated Production Supabase / PostgreSQL Instance
-- Network: Arc Mainnet (Chain ID: 5042001)
-- ==============================================================================
-- IMPORTANT EXECUTION INSTRUCTIONS:
-- 1. Execute this script ONLY against the fresh, isolated Production Supabase instance.
--    DO NOT run this against the permanent testnet sandbox database.
-- 2. This script is fully transactional and idempotent.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. DROP TESTNET (5042002) HARDCODED COLUMN DEFAULTS
-- Prevents omitted insert parameters from silently stamping testnet chain ID on mainnet rows.
-- ------------------------------------------------------------------------------

-- 1a. payment_sessions.chain_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_sessions' 
          AND column_name = 'chain_id' 
          AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE payment_sessions ALTER COLUMN chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped hardcoded default from payment_sessions.chain_id';
    END IF;
END $$;

-- 1b. payment_links.settlement_chain_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_links' 
          AND column_name = 'settlement_chain_id' 
          AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE payment_links ALTER COLUMN settlement_chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped hardcoded default from payment_links.settlement_chain_id';
    END IF;
END $$;

-- 1c. payment_link_checkout_attempts.settlement_chain_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_link_checkout_attempts' 
          AND column_name = 'settlement_chain_id' 
          AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE payment_link_checkout_attempts ALTER COLUMN settlement_chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped hardcoded default from payment_link_checkout_attempts.settlement_chain_id';
    END IF;
END $$;

-- 1d. payment_link_payments.verification_chain_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_link_payments' 
          AND column_name = 'verification_chain_id' 
          AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE payment_link_payments ALTER COLUMN verification_chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped hardcoded default from payment_link_payments.verification_chain_id';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. UPDATE METERED VAULTS ENVIRONMENT & CHAIN CHECK CONSTRAINT
-- Adds the ('LIVE', 5042001) arm to allow live metered vaults on Arc mainnet.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'metered_vaults'
    ) THEN
        -- Drop legacy testnet-only check constraint if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'metered_vaults_environment_chain_check' 
              AND table_name = 'metered_vaults'
        ) THEN
            ALTER TABLE metered_vaults DROP CONSTRAINT metered_vaults_environment_chain_check;
            RAISE NOTICE 'Dropped legacy metered_vaults_environment_chain_check';
        END IF;

        -- Add dual TEST/LIVE constraint
        ALTER TABLE metered_vaults ADD CONSTRAINT metered_vaults_environment_chain_check 
            CHECK (
                (environment = 'TEST' AND settlement_chain_id = 5042002) OR
                (environment = 'LIVE' AND settlement_chain_id = 5042001)
            );
        RAISE NOTICE 'Applied comprehensive metered_vaults_environment_chain_check for TEST (5042002) and LIVE (5042001)';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 3. UPDATE SUBSCRIPTIONS CONTRACT ADDRESS DEFAULT & CONSTRAINTS
-- Remove hardcoded testnet PSA address default so app code must pass active contract address.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscriptions' 
          AND column_name = 'contract_address' 
          AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE subscriptions ALTER COLUMN contract_address DROP DEFAULT;
        RAISE NOTICE 'Dropped hardcoded testnet PSA address default on subscriptions.contract_address';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 4. MIGRATE SUBSCRIPTION BILLING CLAIMS TO COMPOSITE KEY
-- Resolves key contention across contract generations by keying on (contract_address, subscription_id).
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- Ensure contract_address column exists on subscription_billing_claims if not already present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscription_billing_claims' 
          AND column_name = 'contract_address'
    ) THEN
        ALTER TABLE subscription_billing_claims ADD COLUMN contract_address text;
        RAISE NOTICE 'Added contract_address column to subscription_billing_claims';
    END IF;

    -- Re-create composite unique index if table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'subscription_billing_claims'
    ) THEN
        -- Drop single-column unique constraint if present
        IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'subscription_billing_claims_subscription_id_key' 
              AND table_name = 'subscription_billing_claims'
        ) THEN
            ALTER TABLE subscription_billing_claims DROP CONSTRAINT subscription_billing_claims_subscription_id_key;
        END IF;

        -- Create composite index
        CREATE UNIQUE INDEX IF NOT EXISTS subscription_billing_claims_contract_sub_idx 
            ON subscription_billing_claims (lower(contract_address), subscription_id);
        RAISE NOTICE 'Created composite unique index on subscription_billing_claims (contract_address, subscription_id)';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 5. ENABLE LIVE API KEY CREATION (OPTIONAL / AT CUTOVER)
-- Removes test-only constraint on ApiKey.mode if governed by DB constraints.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'api_keys_mode_check' 
          AND table_name = 'api_keys'
    ) THEN
        ALTER TABLE api_keys DROP CONSTRAINT api_keys_mode_check;
        ALTER TABLE api_keys ADD CONSTRAINT api_keys_mode_check CHECK (mode IN ('TEST', 'LIVE'));
        RAISE NOTICE 'Configured api_keys_mode_check to permit TEST and LIVE';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 6. AUDIT & ENFORCE ROW LEVEL SECURITY (RLS) POLICIES ON CRITICAL TABLES
-- Guarantees RLS is enabled and explicit deny-all public policies are attached
-- to all server-only / sensitive tables.
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    tbl text;
    critical_tables text[] := ARRAY[
        'user_embedded_wallets',
        'fiat_funding_intents',
        'fiat_funding_events',
        'admin_audit_log',
        'admin_wallets',
        'webhook_endpoints',
        'webhook_events',
        'api_keys',
        'system_settings',
        'platform_flags',
        'sessions',
        'cli_sessions',
        'private_withdrawals',
        'otp_codes',
        'waitlist_leads',
        'metered_vaults',
        'payment_link_payments',
        'subscription_billing_claims',
        'circle_wallet_provisioning',
        'kyc_verifications',
        'kyc_verification_events'
    ];
BEGIN
    FOREACH tbl IN ARRAY critical_tables
    LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE schemaname = 'public' 
                  AND tablename = tbl 
                  AND policyname = 'Deny all public access'
            ) THEN
                EXECUTE format('CREATE POLICY "Deny all public access" ON public.%I FOR ALL USING (false) WITH CHECK (false)', tbl);
                RAISE NOTICE 'Enforced deny-all RLS on table: %', tbl;
            END IF;
        END IF;
    END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- 7. CONFIGURE DEFAULT SYSTEM SETTINGS & PLATFORM FLAGS
-- Enforces production mainnet operational posture:
-- - withdrawals_enabled = true (fail-closed breaker operational)
-- - hosted_payments_enabled = true (checkout enabled)
-- - local_bank_transfer_enabled = false (mock bank transfer sandbox disabled)
-- - sponsor_emergency_stop = false (gas sponsorship enabled for transactions)
-- - checkout_enabled = true
-- - reconciliation_enabled = true
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- 7a. Configure system_settings
    IF to_regclass('public.system_settings') IS NOT NULL THEN
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS withdrawals_enabled BOOLEAN DEFAULT true;
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS hosted_payments_enabled BOOLEAN DEFAULT true;
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS local_bank_transfer_enabled BOOLEAN DEFAULT false;
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS sponsor_emergency_stop BOOLEAN DEFAULT false;
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS checkout_enabled BOOLEAN DEFAULT true;
        ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS reconciliation_enabled BOOLEAN DEFAULT true;

        INSERT INTO public.system_settings (
            id,
            withdrawals_enabled,
            hosted_payments_enabled,
            local_bank_transfer_enabled,
            sponsor_emergency_stop,
            checkout_enabled,
            reconciliation_enabled,
            updated_at,
            updated_by
        ) VALUES (
            1,
            true,
            true,
            false,
            false,
            true,
            true,
            now(),
            'mainnet_cutover'
        )
        ON CONFLICT (id) DO UPDATE SET
            withdrawals_enabled = true,
            hosted_payments_enabled = true,
            local_bank_transfer_enabled = false,
            sponsor_emergency_stop = false,
            checkout_enabled = true,
            reconciliation_enabled = true,
            updated_at = now(),
            updated_by = 'mainnet_cutover';

        RAISE NOTICE 'Applied system_settings: withdrawals_enabled=true, hosted_payments_enabled=true, local_bank_transfer_enabled=false, sponsor_emergency_stop=false';
    END IF;

    -- 7b. Configure platform_flags (matching Prisma PlatformFlag model)
    IF to_regclass('public.platform_flags') IS NOT NULL THEN
        ALTER TABLE public.platform_flags ADD COLUMN IF NOT EXISTS local_bank_transfer_enabled BOOLEAN DEFAULT false;
        ALTER TABLE public.platform_flags ADD COLUMN IF NOT EXISTS maintenance_enabled BOOLEAN DEFAULT false;
        ALTER TABLE public.platform_flags ADD COLUMN IF NOT EXISTS external_wallet_enabled BOOLEAN DEFAULT true;

        INSERT INTO public.platform_flags (
            id,
            local_bank_transfer_enabled,
            maintenance_enabled,
            external_wallet_enabled,
            updated_at,
            updated_by
        ) VALUES (
            1,
            false,
            false,
            true,
            now(),
            'mainnet_cutover'
        )
        ON CONFLICT (id) DO UPDATE SET
            local_bank_transfer_enabled = false,
            maintenance_enabled = false,
            external_wallet_enabled = true,
            updated_at = now(),
            updated_by = 'mainnet_cutover';

        RAISE NOTICE 'Applied platform_flags: local_bank_transfer_enabled=false';
    END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICATION QUERIES (Run to verify cutover state):
-- 
-- 1. Check default values (Should return 0 rows):
--    SELECT table_name, column_name, column_default 
--    FROM information_schema.columns 
--    WHERE table_name IN ('payment_sessions', 'payment_links', 'payment_link_checkout_attempts') 
--      AND column_default LIKE '%5042002%';
--
-- 2. Check metered_vaults constraint definition:
--    SELECT conname, pg_get_constraintdef(oid) 
--    FROM pg_constraint 
--    WHERE conname = 'metered_vaults_environment_chain_check';
--
-- 3. Check operational breakers in system_settings and platform_flags:
--    SELECT withdrawals_enabled, hosted_payments_enabled, local_bank_transfer_enabled, sponsor_emergency_stop 
--    FROM public.system_settings WHERE id = 1;
--    SELECT local_bank_transfer_enabled FROM public.platform_flags WHERE id = 1;
--
-- 4. Check RLS status and policies on critical tables:
--    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;
-- ==============================================================================
