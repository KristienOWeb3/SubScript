/*
 * Durable vault-commit intents.
 *
 * Commit idempotency used to live in a React ref: a browser reload after an ambiguous
 * response minted a fresh x-request-id and could escrow twice. Every money-moving commit
 * now persists an intent row BEFORE submission, keyed by the client's validated request
 * id. Retries — same tab, a reloaded tab, another instance — resolve the intent first
 * and reuse the same Circle idempotency key; a second commit is never submitted while
 * the first is ambiguous.
 *
 * Status:
 *   PENDING   — intent recorded; custody submission may or may not have happened.
 *   SUBMITTED — custody returned a transaction hash; mirror not yet synced.
 *   MIRRORED  — hash bound and the off-chain mirror reflects the chain. Terminal.
 *   FAILED    — proven pre-submission failure. Terminal (retry allowed with same id).
 */

CREATE TABLE IF NOT EXISTS public.vault_commit_intents (
    request_id TEXT PRIMARY KEY CHECK (request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
    user_address TEXT NOT NULL CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
    merchant_address TEXT NOT NULL CHECK (merchant_address ~ '^0x[0-9a-f]{40}$'),
    amount_usdc NUMERIC(38, 0) NOT NULL CHECK (amount_usdc > 0),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment IN ('TEST', 'LIVE')),
    custody_idempotency_key TEXT NOT NULL,
    sponsor_request_key TEXT,
    tx_hash TEXT CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'MIRRORED', 'FAILED')),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_commit_intents_user_idx
    ON public.vault_commit_intents (user_address, created_at DESC);

ALTER TABLE public.vault_commit_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vault_commit_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vault_commit_intents TO service_role, postgres;
