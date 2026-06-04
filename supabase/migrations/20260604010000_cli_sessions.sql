-- Migration: Create cli_sessions table for secure onboarding bridge
CREATE TABLE IF NOT EXISTS cli_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    hash_version TEXT NOT NULL DEFAULT 'sha256',
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    tier INT NOT NULL DEFAULT 0,
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'zk-routed')),
    used BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security and enforce default deny policy
ALTER TABLE cli_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access on cli_sessions" ON cli_sessions;
CREATE POLICY "Deny all public access on cli_sessions" ON cli_sessions FOR ALL USING (false);

-- Index expires_at for efficient cleanups
CREATE INDEX IF NOT EXISTS idx_cli_sessions_expires_at ON cli_sessions(expires_at);
