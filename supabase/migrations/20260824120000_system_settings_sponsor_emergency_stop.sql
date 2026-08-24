/*
 * A runtime home for the sponsored-gas emergency stop.
 *
 * WHY THIS EXISTS
 * ---------------
 * Finding 3 of docs/admin-capabilities-audit.md: stopping sponsored gas required shipping an
 * env change, so draining the sponsor wallet was answered with a redeploy instead of a
 * button. That finding was marked fixed when platform_flags gained a `sponsorEmergencyStop`
 * field in TypeScript — but the COLUMN was never created. src/lib/platform/flags.ts read it
 * off the row through an `as any` cast, got undefined, and fell back to
 * process.env.SPONSOR_EMERGENCY_STOP. The console toggle wrote to Redis, which nothing on the
 * sponsor path reads. The stop was still env-only, and now it looked like a working switch.
 *
 * WHY system_settings AND NOT platform_flags
 * ------------------------------------------
 * Because system_settings is where the breakers that actually work already live. Its
 * withdrawals_enabled is enforced fail-closed in api/execute-tx, hosted_payments_enabled is
 * enforced by seven checkout functions in this directory, checkout_enabled by
 * api/premium/checkout, and reconciliation_enabled by the reconciliation worker. The table
 * had no admin UI, so those switches were only reachable by hand-editing a row, while the
 * console offered switches over platform_flags that no code consulted.
 *
 * Consolidating the two tables is the right end state and deliberately NOT done here: it
 * means repointing seven live money-path consumers, which does not belong in a fix for a
 * broken breaker. This migration adds the one missing column so the console can drive the
 * table that already has teeth.
 *
 * FAILURE POSTURE
 * ---------------
 * The reader (isSponsorEmergencyStopped in @/lib/platform/systemSettings) fails OPEN — an
 * unreadable row means "not stopped" — and ORs the SPONSOR_EMERGENCY_STOP env var on top.
 * That preserves exactly what gas.ts and sponsorship.ts did before this change, and it keeps
 * env as the lever that still works when Postgres does not. Failing closed here would halt
 * every sponsored payment on a transient database blip, which is the product's whole payment
 * path.
 *
 * Idempotent, matching the house style in 20260809120001_vault_commit_sharing_reports.sql.
 */

-- Runtime kill switch for sponsored gas. Read through @/lib/platform/systemSettings, never
-- directly, so the cache and the env-var OR apply.
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS sponsor_emergency_stop BOOLEAN NOT NULL DEFAULT false;

-- The seed row predates this column and takes the DEFAULT, so no backfill is needed. Stated
-- rather than assumed: a future reader should not have to check whether false was intended.
