-- Additive on-chain mirror columns for metered_vaults (vault escrow economics).
-- These are DORMANT: nothing reads/writes them until the SubScriptVault proxy and
-- keeper are deployed and the report-usage/config routes + UI are cut over. The
-- existing prepaid/top-up columns are retained for compatibility until then.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS no-ops if the column already exists, and the
-- inline non-negative CHECKs are created with the column so re-runs are safe.
-- RLS is unchanged: metered_vaults already has a default-deny policy that covers all
-- columns, and only the service role (which bypasses RLS) touches this table.

ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS commit_usdc BIGINT NOT NULL DEFAULT 0 CHECK (commit_usdc >= 0);
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS owed_usdc BIGINT NOT NULL DEFAULT 0 CHECK (owed_usdc >= 0);
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS accrued_usage_usdc BIGINT NOT NULL DEFAULT 0 CHECK (accrued_usage_usdc >= 0);
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS cycle_start TIMESTAMPTZ;
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS vault_chain_id INTEGER;
ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS last_synced_block BIGINT;
