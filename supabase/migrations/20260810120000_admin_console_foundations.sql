-- Admin console foundations: two-tier admin identity, moderation tables, audit log,
-- and runtime system flags.
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- The admin console (admin.subscriptonarc.com) grants real operational powers:
-- verifying merchants, banning accounts/IPs, pausing the site, and broadcasting.
-- Those powers need three things this migration creates:
--
--  1. ADMIN_IDENTITY. Admins come from two tiers that UNION together:
--       * ROOT admins — ADMIN_WALLET_ADDRESSES env var. Irrevocable from the
--         console; the recovery path that survives a bad DB, a bad deploy, or a
--         mistake in the console.
--       * DELEGATED admins — admin_wallets table, granted/revoked in the console
--         by a root admin only.
--     admin_wallets is written by the console and mirrored to a Redis set
--     (admin:wallets) so the edge middleware can check it; the DB is the durable
--     source of truth and the edge degrades to env-only when Redis is unreachable.
--
--  2. MODERATION TABLES. BannedAccount/BannedIp have existed in prisma/schema.prisma
--     since 2026-07 but NO migration ever created their tables — the ban form has
--     500'd on every submission since it was written. These tables are greenfield,
--     so they carry banned_by (for the audit trail) and expires_at (temporary bans)
--     from day one; the checksum enforcement in apply-migrations.mjs means adding
--     those columns later would cost a second migration. RLS is deny-all: these are
--     written and read only through authenticated API routes, never by the client.
--
--  3. ADMIN_AUDIT_LOG. Every admin action is irreversible-ish and affects other
--     people's accounts; this append-only log answers "who banned this wallet and
--     when". Deliberately no update path and no updated_at.
--
--  4. RUNTIME SYSTEM FLAGS. system_settings is the singleton (id=1) flags table.
--     maintenance_level and maintenance_message drive the site pause (soft = pages
--     + new checkouts blocked, in-flight settlement finishes; hard = everything
--     503s); google_signin_enabled turns Continue-with-Google on/off at runtime
--     instead of at build time.
--
-- All statements are idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS / DROP POLICY IF EXISTS before CREATE POLICY), matching the house style
-- in 20260603030000_operational_hardening.sql and
-- 20260714072112_repair_system_settings_payment_flags.sql. Runs in one transaction.

-- ---------------------------------------------------------------------------
-- 1. Delegated admin wallets (console-managed; root admins come from env)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_wallets (
    wallet     TEXT PRIMARY KEY,          -- lowercased checksummed address, enforced by the writer
    label      TEXT,                      -- free-form label shown in the console
    granted_by TEXT NOT NULL,             -- root admin wallet who granted access
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_wallets" ON public.admin_wallets;
CREATE POLICY "Deny all public access on admin_wallets" ON public.admin_wallets FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 2. Moderation tables (banned accounts and IPs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.banned_accounts (
    address    TEXT PRIMARY KEY,          -- lowercased wallet address
    reason     TEXT,
    banned_by  TEXT NOT NULL,             -- admin wallet who issued the ban
    expires_at TIMESTAMPTZ,               -- NULL = permanent
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.banned_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on banned_accounts" ON public.banned_accounts;
CREATE POLICY "Deny all public access on banned_accounts" ON public.banned_accounts FOR ALL USING (false);

CREATE TABLE IF NOT EXISTS public.banned_ips (
    ip         TEXT PRIMARY KEY,          -- dotted-quad IPv4 or IPv6 literal
    reason     TEXT,
    banned_by  TEXT NOT NULL,             -- admin wallet who issued the ban
    expires_at TIMESTAMPTZ,               -- NULL = permanent
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.banned_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on banned_ips" ON public.banned_ips;
CREATE POLICY "Deny all public access on banned_ips" ON public.banned_ips FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 3. Append-only admin audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor      TEXT NOT NULL,             -- admin wallet who performed the action, lowercased
    action     TEXT NOT NULL,             -- MERCHANT_VERIFY | BAN_ACCOUNT | UNBAN_ACCOUNT | BAN_IP | UNBAN_IP | MAINTENANCE_SET | GOOGLE_SIGNIN_SET | ADMIN_WALLET_GRANT | ADMIN_WALLET_REVOKE | BROADCAST_CREATED | RECEIPT_INVITE
    target     TEXT,                      -- wallet / ip / receiptId / flag name
    detail     JSONB,                     -- before/after, reason, audience, counts
    ip         TEXT,                      -- request IP when available
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON public.admin_audit_log (target, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_audit_log" ON public.admin_audit_log;
CREATE POLICY "Deny all public access on admin_audit_log" ON public.admin_audit_log FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 4. Broadcast jobs (queued fan-out; drained in batches by API + cron)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_broadcasts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audience         TEXT NOT NULL CHECK (audience IN ('users', 'merchants', 'both')),
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    url              TEXT,
    created_by       TEXT NOT NULL,       -- admin wallet
    status           TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
    cursor           TEXT,                -- last recipient address processed, for resume
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count       INTEGER NOT NULL DEFAULT 0,
    failed_count     INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

ALTER TABLE public.admin_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_broadcasts" ON public.admin_broadcasts;
CREATE POLICY "Deny all public access on admin_broadcasts" ON public.admin_broadcasts FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 5. Runtime system flags (maintenance + Google sign-in)
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS maintenance_level TEXT NOT NULL DEFAULT 'off' CHECK (maintenance_level IN ('off', 'soft', 'hard')),
    ADD COLUMN IF NOT EXISTS maintenance_message TEXT,
    ADD COLUMN IF NOT EXISTS google_signin_enabled BOOLEAN NOT NULL DEFAULT false;

-- Default-off matches production today: NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED is unset
-- in every local env file, so the button is hidden and the endpoint fails closed.
INSERT INTO public.system_settings (id, maintenance_level, maintenance_message, google_signin_enabled)
VALUES (1, 'off', NULL, false)
ON CONFLICT (id) DO NOTHING;
