/* Create applied_migrations registry table to track SUE database migrations */
CREATE TABLE IF NOT EXISTS applied_migrations (
    migration_id TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT now(),
    snapshot_id TEXT NOT NULL,
    verified_by_signature TEXT NOT NULL
);
