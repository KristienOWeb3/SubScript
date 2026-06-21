/* Live readiness repair for runtime-only backend objects and Supabase RLS.
   This migration is intentionally idempotent and avoids data deletion. */

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS receipt_token TEXT;
ALTER TABLE payment_links
    ALTER COLUMN receipt_token SET DEFAULT ('rcpt-' || encode(gen_random_bytes(16), 'hex'));
UPDATE payment_links
SET receipt_token = 'rcpt-' || encode(gen_random_bytes(16), 'hex')
WHERE receipt_token IS NULL
   OR receipt_token !~ '^rcpt-[0-9a-f]{32}$';
ALTER TABLE payment_links
    ALTER COLUMN receipt_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_links_receipt_token_idx
    ON payment_links(receipt_token);

CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx ON otp_codes (expires_at);

ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS processing_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS last_error TEXT DEFAULT NULL;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS failure_code TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY DEFAULT 1 CONSTRAINT single_row CHECK (id = 1),
    premium_enabled BOOLEAN DEFAULT true,
    withdrawals_enabled BOOLEAN DEFAULT true,
    private_routing_enabled BOOLEAN DEFAULT true,
    deposits_enabled BOOLEAN DEFAULT true,
    checkout_enabled BOOLEAN DEFAULT true,
    reconciliation_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by TEXT DEFAULT 'system'
);

INSERT INTO system_settings (
    id, premium_enabled, withdrawals_enabled, private_routing_enabled,
    deposits_enabled, checkout_enabled, reconciliation_enabled
) VALUES (
    1, true, true, true, true, true, true
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cli_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    hash_version TEXT NOT NULL DEFAULT 'sha256',
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'FREE',
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'zk-routed')),
    used BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cli_sessions_expires_at_idx ON cli_sessions(expires_at);

CREATE TABLE IF NOT EXISTS private_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    amount NUMERIC,
    commitment_hash TEXT NOT NULL,
    nullifier_hash TEXT NOT NULL UNIQUE,
    withdrawal_tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    completed_at TIMESTAMPTZ,
    proof_type TEXT NOT NULL DEFAULT 'commit_reveal',
    rpc_endpoint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_withdrawals_merchant_address_idx ON private_withdrawals (merchant_address);
CREATE INDEX IF NOT EXISTS private_withdrawals_withdrawal_tx_hash_idx ON private_withdrawals (withdrawal_tx_hash);
CREATE INDEX IF NOT EXISTS private_withdrawals_status_idx ON private_withdrawals (status);

CREATE TABLE IF NOT EXISTS premium_upgrade_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant TEXT NOT NULL,
    payment_session UUID UNIQUE NOT NULL REFERENCES payment_sessions(session_id) ON DELETE CASCADE,
    tx_hash TEXT UNIQUE NOT NULL,
    chain_id INT NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT now(),
    tier_before INT NOT NULL,
    tier_after INT NOT NULL,
    admin_wallet TEXT NOT NULL,
    activation_tx_hash TEXT NOT NULL,
    rpc_endpoint TEXT
);

CREATE OR REPLACE VIEW merchant_spendable_balances
WITH (security_invoker = true) AS
WITH credit_totals AS (
    SELECT merchant_address, SUM(amount_usdc) AS settled_credits
    FROM ledger_entries
    WHERE entry_type IN ('CREDIT_PAYMENT', 'CREDIT_PAYMENT_LINK')
      AND status = 'FINALIZED'
    GROUP BY merchant_address
),
debit_finalized_totals AS (
    SELECT merchant_address, SUM(amount_usdc) AS settled_debits
    FROM ledger_entries
    WHERE entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT')
      AND status = 'FINALIZED'
    GROUP BY merchant_address
),
debit_pending_totals AS (
    SELECT merchant_address, SUM(amount_usdc) AS pending_debits
    FROM ledger_entries
    WHERE entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT', 'RESERVE')
      AND status = 'PENDING'
    GROUP BY merchant_address
)
SELECT
    m.wallet_address,
    COALESCE(c.settled_credits, 0) - COALESCE(df.settled_debits, 0) AS settled_balance,
    COALESCE(c.settled_credits, 0) - COALESCE(df.settled_debits, 0) - COALESCE(dp.pending_debits, 0) AS spendable_balance
FROM merchants m
LEFT JOIN credit_totals c ON c.merchant_address = decode(substring(m.wallet_address FROM 3), 'hex')
LEFT JOIN debit_finalized_totals df ON df.merchant_address = decode(substring(m.wallet_address FROM 3), 'hex')
LEFT JOIN debit_pending_totals dp ON dp.merchant_address = decode(substring(m.wallet_address FROM 3), 'hex');

CREATE OR REPLACE FUNCTION claim_pending_payment_sessions(batch_size INT)
RETURNS SETOF payment_sessions AS $$
BEGIN
    RETURN QUERY
    UPDATE payment_sessions
    SET status = 'PROCESSING',
        processing_started_at = now()
    WHERE session_id IN (
        SELECT session_id
        FROM payment_sessions
        WHERE (
            status IN ('PENDING', 'FAILED')
            OR (status = 'PROCESSING' AND processing_started_at < now() - INTERVAL '10 minutes')
          )
          AND status NOT IN ('COMPLETED', 'FAILED_PERMANENTLY', 'NEEDS_RECONCILIATION')
          AND tx_hash IS NOT NULL
          AND processing_attempts < 5
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION activate_premium_merchant(
    p_merchant_address TEXT,
    p_subscription_id BIGINT,
    p_session_id UUID,
    p_tx_hash TEXT,
    p_amount NUMERIC,
    p_period BIGINT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO merchants (wallet_address, tier, updated_at)
    VALUES (p_merchant_address, 'PREMIUM', now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 'PREMIUM', updated_at = now();

    INSERT INTO subscriptions (
        subscription_id, merchant_address, current_nonce, last_settlement_timestamp,
        billing_interval_seconds, amount_cap_usdc, payment_tx_hash, status, updated_at
    )
    VALUES (
        p_subscription_id, p_merchant_address, 0, now(),
        p_period, p_amount, p_tx_hash, 'ACTIVE', now()
    )
    ON CONFLICT (subscription_id)
    DO UPDATE SET
        merchant_address = p_merchant_address,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = p_tx_hash,
        status = 'ACTIVE',
        updated_at = now();

    UPDATE payment_sessions
    SET status = 'COMPLETED', updated_at = now()
    WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION compact_event_log()
RETURNS VOID AS $$
DECLARE
    r RECORD;
    v_max_seq BIGINT;
    v_state JSONB;
BEGIN
    FOR r IN SELECT DISTINCT entity_type, entity_id FROM event_log LOOP
        SELECT MAX(sequence_number) INTO v_max_seq
        FROM event_log
        WHERE entity_type = r.entity_type AND entity_id = r.entity_id;

        IF r.entity_type = 'MERCHANT' THEN
            SELECT jsonb_build_object(
                'spendable_balance', spendable_balance,
                'settled_balance', settled_balance
            ) INTO v_state
            FROM merchant_spendable_balances
            WHERE wallet_address = r.entity_id;
        ELSE
            v_state := '{}'::jsonb;
        END IF;

        IF v_state IS NOT NULL THEN
            INSERT INTO system_snapshots (entity_id, entity_type, sequence_offset, state_payload)
            VALUES (r.entity_id, r.entity_type, v_max_seq, v_state);

            DELETE FROM event_log
            WHERE entity_type = r.entity_type
              AND entity_id = r.entity_id
              AND sequence_number <= v_max_seq;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX IF NOT EXISTS user_embedded_wallets_email_lower_unique_idx
    ON user_embedded_wallets (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_unique_idx
    ON customers (lower(email))
    WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_account_email_reuse()
RETURNS TRIGGER AS $$
DECLARE
    conflicting_wallet TEXT;
BEGIN
    IF NEW.email IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'user_embedded_wallets' THEN
        SELECT wallet_address INTO conflicting_wallet
          FROM customers
         WHERE email IS NOT NULL
           AND lower(email) = lower(NEW.email)
           AND lower(wallet_address) <> lower(NEW.wallet_address)
         LIMIT 1;
    ELSIF TG_TABLE_NAME = 'customers' THEN
        SELECT wallet_address INTO conflicting_wallet
          FROM user_embedded_wallets
         WHERE lower(email) = lower(NEW.email)
           AND lower(wallet_address) <> lower(NEW.wallet_address)
         LIMIT 1;
    END IF;

    IF conflicting_wallet IS NOT NULL THEN
        RAISE EXCEPTION 'Email is already associated with another SubScript account'
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_user_embedded_wallet_email_reuse ON user_embedded_wallets;
CREATE TRIGGER prevent_user_embedded_wallet_email_reuse
    BEFORE INSERT OR UPDATE OF email, wallet_address ON user_embedded_wallets
    FOR EACH ROW
    EXECUTE FUNCTION prevent_account_email_reuse();

DROP TRIGGER IF EXISTS prevent_customer_email_reuse ON customers;
CREATE TRIGGER prevent_customer_email_reuse
    BEFORE INSERT OR UPDATE OF email, wallet_address ON customers
    FOR EACH ROW
    EXECUTE FUNCTION prevent_account_email_reuse();

DO $$
DECLARE
    table_name TEXT;
    policy_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'account_roles',
        'address_aliases',
        'api_keys',
        'audit_events',
        'cli_sessions',
        'customers',
        'event_log',
        'idempotency_keys',
        'ledger_entries',
        'merchant_email_templates',
        'merchants',
        'metered_vaults',
        'otp_codes',
        'payment_link_payments',
        'payment_links',
        'payment_sessions',
        'payout_batch_chunks',
        'payout_batch_items',
        'payout_batches',
        'payroll_campaigns',
        'payroll_recipients',
        'premium_upgrade_events',
        'private_withdrawals',
        'receipts',
        'sessions',
        'subscript_dms',
        'subscriptions',
        'system_settings',
        'system_snapshots',
        'transaction_verifications',
        'user_embedded_wallets',
        'waitlist_leads',
        'webhook_deliveries',
        'webhook_endpoints',
        'webhook_events'
    ]
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            policy_name := 'Deny all public access on ' || table_name;
            IF NOT EXISTS (
                SELECT 1
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = table_name
                  AND policyname = policy_name
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR ALL USING (false) WITH CHECK (false)',
                    policy_name,
                    table_name
                );
            END IF;
        END IF;
    END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
