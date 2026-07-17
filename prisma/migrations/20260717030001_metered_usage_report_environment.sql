/*
 * Settlement environment on metered usage reports (companion to
 * supabase/migrations/20260717030000_api_key_mode_isolation.sql).
 *
 * This ALTER lives in prisma/migrations, not supabase/migrations, because
 * metered_usage_reports is created here (20260710000000_metered_usage_ledger_and_reports.sql).
 * scripts/apply-migrations.mjs runs prisma/migrations before supabase/migrations, so the
 * table always exists by the time this runs — while `supabase start`, which only applies
 * supabase/migrations, never sees a dependency it cannot satisfy.
 *
 * Deliberately NOT guarded by a table-existence check: a silent skip would let the
 * migration ledger record this as applied while the column is absent, and the usage-report
 * insert writes `environment` on every call. Missing preconditions must fail loudly.
 */

ALTER TABLE public.metered_usage_reports
    ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'TEST'
        CHECK (environment IN ('TEST', 'LIVE'));
