/*
 * Operational breaker for usage-based vaults.
 *
 * Usage vaults let a merchant report consumption that the keeper then draws from the user's
 * escrow at cycle end. Reports are self-declared, so an operator needs a way to stop that money
 * moving platform-wide while a dispute or abuse report is investigated, without touching the
 * contract. When this is false:
 *   - the vault-draw keeper draws nothing (api/keeper/vault-draw)
 *   - merchants cannot report new usage (api/user/vault/report-usage)
 *   - users cannot open new vaults or add funds (api/user/vault/commit, topup)
 * Users can still withdraw, cancel and reclaim, so their escrow is never trapped.
 *
 * Default true: adding the column changes nothing until an admin flips it.
 */
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS usage_vaults_enabled BOOLEAN NOT NULL DEFAULT true;
