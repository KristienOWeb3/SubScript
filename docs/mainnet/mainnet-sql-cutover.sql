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
          AND column_default LIKE '%5042002%'
    ) THEN
        ALTER TABLE payment_sessions ALTER COLUMN chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped default 5042002 from payment_sessions.chain_id';
    END IF;
END $$;

-- 1b. payment_links.settlement_chain_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_links' 
          AND column_name = 'settlement_chain_id' 
          AND column_default LIKE '%5042002%'
    ) THEN
        ALTER TABLE payment_links ALTER COLUMN settlement_chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped default 5042002 from payment_links.settlement_chain_id';
    END IF;
END $$;

-- 1c. payment_link_payments.verification_chain_id (if default exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_link_payments' 
          AND column_name = 'verification_chain_id' 
          AND column_default LIKE '%5042002%'
    ) THEN
        ALTER TABLE payment_link_payments ALTER COLUMN verification_chain_id DROP DEFAULT;
        RAISE NOTICE 'Dropped default 5042002 from payment_link_payments.verification_chain_id';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. UPDATE METERED VAULTS ENVIRONMENT & CHAIN CHECK CONSTRAINT
-- Adds the ('LIVE', 5042001) arm to allow live metered vaults on Arc mainnet.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- Drop the testnet-only check constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'metered_vaults_environment_chain_check' 
          AND table_name = 'metered_vaults'
    ) THEN
        ALTER TABLE metered_vaults DROP CONSTRAINT metered_vaults_environment_chain_check;
        RAISE NOTICE 'Dropped legacy metered_vaults_environment_chain_check';
    END IF;

    -- Add the dual TEST/LIVE constraint
    ALTER TABLE metered_vaults ADD CONSTRAINT metered_vaults_environment_chain_check 
        CHECK (
            (environment = 'TEST' AND settlement_chain_id = 5042002) OR
            (environment = 'LIVE' AND settlement_chain_id = 5042001)
        );
    RAISE NOTICE 'Applied comprehensive metered_vaults_environment_chain_check for TEST (5042002) and LIVE (5042001)';
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
-- Removes test-only constraint on ApiKey.mode if governed by DB triggers.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- Verify ApiKey mode column supports 'LIVE'
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
-- 6. AUDIT ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures all sensitive tables have RLS enabled with deny-by-default public access.
-- ------------------------------------------------------------------------------

ALTER TABLE IF EXISTS user_embedded_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fiat_funding_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fiat_funding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_keys ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ==============================================================================
-- VERIFICATION QUERIES (Run to verify cutover state):
-- 
-- 1. Check default values (Should return 0 rows):
--    SELECT table_name, column_name, column_default 
--    FROM information_schema.columns 
--    WHERE table_name IN ('payment_sessions', 'payment_links') 
--      AND column_default LIKE '%5042002%';
--
-- 2. Check metered_vaults constraint definition:
--    SELECT conname, pg_get_constraintdef(oid) 
--    FROM pg_constraint 
--    WHERE conname = 'metered_vaults_environment_chain_check';
-- ==============================================================================
