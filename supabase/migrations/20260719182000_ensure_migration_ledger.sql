/*
 * Ensure the _subscript_migrations ledger table exists before expand_schemas
 * tries to ALTER it. In production, apply-migrations.mjs creates this table;
 * Supabase's local runner does not — this migration bridges the gap for E2E.
 */
CREATE TABLE IF NOT EXISTS public._subscript_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    baseline   boolean NOT NULL DEFAULT false
);
