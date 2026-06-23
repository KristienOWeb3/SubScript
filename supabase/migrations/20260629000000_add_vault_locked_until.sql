-- Mirror column for the vault's withdrawal lock (escrow is withdrawable only at/after
-- this time — one cycle / ~30 days after commit). Additive, idempotent.

ALTER TABLE metered_vaults ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
