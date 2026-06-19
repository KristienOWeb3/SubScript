/* Reset account state so every wallet must sign up and choose exactly one role again. */

BEGIN;

/* Ensure merchant tier values are textual before resetting tiers. */
ALTER TABLE merchants ALTER COLUMN tier DROP DEFAULT;
ALTER TABLE merchants ALTER COLUMN tier TYPE TEXT USING tier::TEXT;
ALTER TABLE merchants ALTER COLUMN tier SET DEFAULT 'FREE';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shielded_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS view_key_hash TEXT DEFAULT NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS profile_pic TEXT DEFAULT NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_settlement_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dispute_alerts_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS security_multi_sig_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE merchants
SET
    tier = 'FREE',
    shielded_payouts_enabled = false,
    view_key_hash = NULL,
    verified = false,
    profile_pic = NULL,
    push_enabled = true,
    email_enabled = true,
    payout_settlement_enabled = true,
    dispute_alerts_enabled = true,
    security_multi_sig_enabled = false,
    updated_at = now();

/* Clear account/session state. Wallets must authenticate and choose USER or ENTERPRISE again. */
DO $$
BEGIN
    IF to_regclass('public.subscript_dms') IS NOT NULL THEN
        DELETE FROM subscript_dms;
    END IF;
    IF to_regclass('public.receipts') IS NOT NULL THEN
        DELETE FROM receipts;
    END IF;
    IF to_regclass('public.account_roles') IS NOT NULL THEN
        DELETE FROM account_roles;
    END IF;
    IF to_regclass('public.customers') IS NOT NULL THEN
        DELETE FROM customers;
    END IF;
    IF to_regclass('public.user_embedded_wallets') IS NOT NULL THEN
        DELETE FROM user_embedded_wallets;
    END IF;
    IF to_regclass('public.sessions') IS NOT NULL THEN
        DELETE FROM sessions;
    END IF;
    IF to_regclass('public.otp_codes') IS NOT NULL THEN
        DELETE FROM otp_codes;
    END IF;
    IF to_regclass('public.address_aliases') IS NOT NULL THEN
        DELETE FROM address_aliases;
    END IF;
END $$;

COMMIT;
