/*
 * User-initiated cancellation of a metered (commit-vault) service.
 *
 * `cancel_requested_at` records when the user asked to stop the service. Once set:
 *   - report-usage refuses to accrue further usage (the keeper draw is frozen to the
 *     pre-cancel accrued total — the merchant is settled only for service already rendered);
 *   - the merchant is notified (DM + webhook) to stop rendering service;
 *   - the user withdraws the unused escrow after locked_until elapses.
 * The column is cleared when the user re-commits (an explicit opt back in).
 *
 * Idempotent: safe to re-run. metered_vaults is created in
 * 20260710000000_metered_usage_ledger_and_reports.sql, which apply-migrations runs first.
 */

ALTER TABLE public.metered_vaults
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
