-- Durable idempotency for Circle wallet provisioning (Phase 1 custody cutover).
-- One row per provisioning subject (ref_id = the stable non-PII user id, e.g. sha256(email)).
-- The idempotency_key is minted once and reused on every retried attempt, so a signup that
-- failed after Circle created the wallet (e.g. the user_embedded_wallets insert lost a race)
-- re-requests the SAME wallet from Circle instead of minting an orphaned second one.
-- circle_wallet_id / wallet_address are best-effort bookkeeping filled in after success,
-- for reconciliation against Circle's console.

CREATE TABLE IF NOT EXISTS circle_wallet_provisioning (
    ref_id TEXT PRIMARY KEY,
    idempotency_key UUID NOT NULL,
    circle_wallet_id TEXT,
    wallet_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-only table (service role bypasses RLS): explicit deny-all, matching the rest of the schema.
ALTER TABLE circle_wallet_provisioning ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access" ON circle_wallet_provisioning;
CREATE POLICY "Deny all public access" ON circle_wallet_provisioning FOR ALL USING (false);
