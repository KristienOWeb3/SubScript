-- Fixed-window counters shared by every application instance. Keys are SHA-256
-- digests so source IPs and transaction hashes are not stored in plaintext.
CREATE TABLE IF NOT EXISTS public.api_rate_limit_windows (
    scope TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (scope, key_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_windows_expiry_idx
    ON public.api_rate_limit_windows (expires_at);

ALTER TABLE public.api_rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_rate_limit_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limit_windows TO service_role;

-- Durable operations queue for cases where an on-chain payment succeeded but
-- the local mirror/idempotency update did not. The unique dedupe key turns
-- repeated reports for the same settlement into an atomic upsert.
CREATE TABLE IF NOT EXISTS public.payment_reconciliation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RETRY_REQUESTED', 'PROCESSING', 'RESOLVED')),
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_events_work_queue_idx
    ON public.payment_reconciliation_events (next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'RETRY_REQUESTED');

CREATE INDEX IF NOT EXISTS payment_reconciliation_events_status_created_idx
    ON public.payment_reconciliation_events (status, created_at DESC);

ALTER TABLE public.payment_reconciliation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_reconciliation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_reconciliation_events TO service_role;
