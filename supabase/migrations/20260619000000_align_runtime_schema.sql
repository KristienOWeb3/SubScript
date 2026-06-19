/* Align Supabase runtime schema with Prisma models and current API writes. */

/* Merchants now use textual tiers and store dashboard preference fields. */
ALTER TABLE merchants ALTER COLUMN tier DROP DEFAULT;
ALTER TABLE merchants ALTER COLUMN tier TYPE TEXT USING tier::TEXT;
ALTER TABLE merchants ALTER COLUMN tier SET DEFAULT 'FREE';
UPDATE merchants SET tier = 'FREE' WHERE tier = '0';
UPDATE merchants SET tier = 'PREMIUM' WHERE tier = '1';

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS available_balance_usdc BIGINT NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reserved_balance_usdc BIGINT NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shielded_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS view_key_hash TEXT DEFAULT NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS profile_pic TEXT DEFAULT NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_settlement_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dispute_alerts_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS security_multi_sig_enabled BOOLEAN NOT NULL DEFAULT false;

/* User dashboard settings are persisted on customers. */
CREATE TABLE IF NOT EXISTS customers (
    wallet_address TEXT PRIMARY KEY,
    email TEXT,
    profile_pic TEXT,
    spending_limit_daily BIGINT,
    spending_limit_weekly BIGINT,
    spending_limit_monthly BIGINT,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    email_enabled BOOLEAN NOT NULL DEFAULT true,
    debit_success_enabled BOOLEAN NOT NULL DEFAULT true,
    expiry_warning_enabled BOOLEAN NOT NULL DEFAULT true,
    security_shield_enabled BOOLEAN NOT NULL DEFAULT false,
    security_multi_sig_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS profile_pic TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS spending_limit_daily BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS spending_limit_weekly BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS spending_limit_monthly BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS debit_success_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS expiry_warning_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS security_shield_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS security_multi_sig_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ALTER COLUMN created_at SET DEFAULT now();

/* Embedded wallets originally used email as the primary key; Prisma now expects a UUID id. */
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE user_embedded_wallets SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE user_embedded_wallets ALTER COLUMN id SET NOT NULL;
ALTER TABLE user_embedded_wallets ALTER COLUMN encrypted_private_key DROP NOT NULL;
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'circle_google';
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS circle_wallet_id TEXT;
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS circle_user_id TEXT;
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS circle_blockchain TEXT;
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS google_subject TEXT;
ALTER TABLE user_embedded_wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE user_embedded_wallets DROP CONSTRAINT IF EXISTS user_embedded_wallets_pkey;
ALTER TABLE user_embedded_wallets ADD CONSTRAINT user_embedded_wallets_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_embedded_wallets_email_idx ON user_embedded_wallets(email);
CREATE UNIQUE INDEX IF NOT EXISTS user_embedded_wallets_wallet_address_idx ON user_embedded_wallets(wallet_address);
CREATE UNIQUE INDEX IF NOT EXISTS user_embedded_wallets_circle_wallet_id_idx
    ON user_embedded_wallets(circle_wallet_id)
    WHERE circle_wallet_id IS NOT NULL;

/* Role selection is the source of truth for one-wallet-one-role enforcement. */
CREATE TABLE IF NOT EXISTS account_roles (
    address TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_roles DROP CONSTRAINT IF EXISTS account_roles_role_check;
ALTER TABLE account_roles
    ADD CONSTRAINT account_roles_role_check CHECK (role IN ('USER', 'ENTERPRISE'));

/* Hosted links gained idempotency, limited use, settlement, and ephemeral receiver fields. */
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS merchant_name_snapshot TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS max_uses INTEGER;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS receiver_address TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS receiver_private_key TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS verified_tx_hash TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS settlement_reference TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS state_snapshot JSONB;
ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_max_uses_check;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0);
ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_use_count_check;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_use_count_check CHECK (use_count >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS payment_links_idempotency_key_idx
    ON payment_links(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

/* Arc memo receipts power shareable Web2-friendly receipt pages. */
CREATE TABLE IF NOT EXISTS receipts (
    receipt_id TEXT PRIMARY KEY,
    payment_link_id UUID REFERENCES payment_links(id) ON DELETE SET NULL,
    payment_link_payment_id UUID REFERENCES payment_link_payments(id) ON DELETE SET NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    chain_id INTEGER NOT NULL,
    memo_contract TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    merchant_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL,
    memo_note TEXT,
    share_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    block_number BIGINT,
    log_index INTEGER,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipts_payer_address_idx ON receipts(payer_address);
CREATE INDEX IF NOT EXISTS receipts_merchant_address_idx ON receipts(merchant_address);
CREATE INDEX IF NOT EXISTS receipts_status_idx ON receipts(status);
CREATE INDEX IF NOT EXISTS receipts_payment_link_id_idx ON receipts(payment_link_id);

/* DMs are system-generated payment conversations between users and merchants. */
CREATE TABLE IF NOT EXISTS subscript_dms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_address TEXT NOT NULL,
    receiver_address TEXT NOT NULL,
    message_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    amount_usdc BIGINT,
    title TEXT,
    description TEXT,
    tx_hash TEXT,
    payment_link_id UUID REFERENCES payment_links(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscript_dms_sender_address_idx ON subscript_dms(sender_address);
CREATE INDEX IF NOT EXISTS subscript_dms_receiver_address_idx ON subscript_dms(receiver_address);
CREATE INDEX IF NOT EXISTS subscript_dms_payment_link_id_idx ON subscript_dms(payment_link_id);

/* Institutional payroll appears in Prisma and merchant APIs. */
DO $$
BEGIN
    CREATE TYPE "PayrollStatus" AS ENUM ('ACTIVE', 'PAUSED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payroll_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_address TEXT NOT NULL,
    title TEXT NOT NULL,
    frequency_days INTEGER NOT NULL,
    next_payday TIMESTAMPTZ NOT NULL,
    is_shielded BOOLEAN NOT NULL,
    status "PayrollStatus" NOT NULL DEFAULT 'ACTIVE',
    permit2_signature TEXT,
    permit2_nonce INTEGER,
    permit2_deadline TIMESTAMPTZ,
    permit2_expiration TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payroll_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES payroll_campaigns(id) ON DELETE CASCADE,
    employee_wallet TEXT NOT NULL,
    salary_amount_usdc BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS payroll_campaigns_organization_address_idx ON payroll_campaigns(organization_address);
CREATE INDEX IF NOT EXISTS payroll_campaigns_status_idx ON payroll_campaigns(status);
CREATE INDEX IF NOT EXISTS payroll_recipients_campaign_id_idx ON payroll_recipients(campaign_id);

/* Keep updated_at columns fresh for Prisma-backed writes. */
CREATE OR REPLACE TRIGGER trigger_update_user_embedded_wallets_updated_at
    BEFORE UPDATE ON user_embedded_wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_account_roles_updated_at
    BEFORE UPDATE ON account_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_subscript_dms_updated_at
    BEFORE UPDATE ON subscript_dms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

/* Supabase Data API exposure remains default-deny; server routes use the service role. */
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_embedded_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscript_dms ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access on customers" ON customers;
CREATE POLICY "Deny all public access on customers" ON customers FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all public access on account_roles" ON account_roles;
CREATE POLICY "Deny all public access on account_roles" ON account_roles FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all public access on receipts" ON receipts;
CREATE POLICY "Deny all public access on receipts" ON receipts FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all public access on subscript_dms" ON subscript_dms;
CREATE POLICY "Deny all public access on subscript_dms" ON subscript_dms FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all public access on payroll_campaigns" ON payroll_campaigns;
CREATE POLICY "Deny all public access on payroll_campaigns" ON payroll_campaigns FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all public access on payroll_recipients" ON payroll_recipients;
CREATE POLICY "Deny all public access on payroll_recipients" ON payroll_recipients FOR ALL USING (false);
