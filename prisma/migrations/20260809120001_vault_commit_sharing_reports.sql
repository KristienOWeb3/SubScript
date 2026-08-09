/*
 * Commit ID tracking on metered usage reports (companion to
 * supabase/migrations/20260809120000_vault_commit_sharing.sql).
 *
 * This ALTER lives in prisma/migrations, not supabase/migrations, because
 * metered_usage_reports is created here (20260710000000_metered_usage_ledger_and_reports.sql).
 * scripts/apply-migrations.mjs runs prisma/migrations before supabase/migrations, so the
 * table always exists by the time this runs — while `supabase start`, which only applies
 * supabase/migrations, never sees a dependency it cannot satisfy.
 */

-- Which commit consumed each usage line, so the primary can see per-friend spend in the ledger
-- and not merely a single undifferentiated total. NULL on pre-existing rows and on usage the
-- primary drove directly through their own address.
ALTER TABLE public.metered_usage_reports
    ADD COLUMN IF NOT EXISTS commit_id TEXT;

-- Per-friend usage history for a vault, newest first.
CREATE INDEX IF NOT EXISTS metered_usage_reports_commit_idx
    ON public.metered_usage_reports (commit_id, created_at DESC)
    WHERE commit_id IS NOT NULL;
