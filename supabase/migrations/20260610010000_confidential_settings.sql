/* Database migration to add shielded payouts and view key configuration columns to merchants table */

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shielded_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS view_key_hash TEXT DEFAULT NULL;
