-- Scoped admin roles, dual control, time-boxed elevation, and admin session history.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Finding 1 of docs/admin-capabilities-audit.md: admin was binary. Root (env) could do
-- everything and delegated (admin_wallets) could do everything except manage the admin list.
-- A support hire therefore arrived with the power to ban any account, freeze any account's
-- withdrawals, decide KYC, and read every user record on day one. Payments platforms split
-- those powers because the blast radius of a compromised support session is otherwise the
-- whole platform.
--
-- WHY SCOPES LIVE ON admin_wallets RATHER THAN IN A ROLES TABLE
-- ------------------------------------------------------------
-- A named-roles table (role -> permissions, wallet -> role) is the textbook shape, and it is
-- the wrong shape here. There are seven scopes and they are a closed set defined in code
-- (src/lib/admin/scopes.ts), because every route has to name the scope it needs at compile
-- time. Putting the same closed set in two places invites drift, and the drift is silent: a
-- role row naming a scope the code does not know grants nothing, and a route naming a scope
-- no role carries locks itself. A TEXT[] on the wallet row cannot drift from the code, and the
-- validation is one array-contains check.
--
-- THE BACKFILL IS DELIBERATELY PERMISSIVE
-- ---------------------------------------
-- Existing delegated admins are backfilled with every scope EXCEPT 'governance' — which is
-- exactly the authority they hold today, since requireRootAdmin already fenced off admin-list
-- management. Deploying this migration therefore changes nobody's power. The alternative
-- (backfill empty, or backfill 'read') would lock out every working delegated admin the moment
-- the deploy landed, during a window where the only recovery path is a root wallet.
--
-- That means the migration alone does not close finding 1 — it makes closing it possible. The
-- console flags legacy-wide admins (see legacy_full_scope below) so an operator can narrow
-- them deliberately rather than discovering the gap during an incident. Every NEW grant is
-- scoped from the start, which is where the gap actually mattered.
--
-- DUAL CONTROL IS A REQUEST/APPROVE QUEUE, NOT A LOCK
-- --------------------------------------------------
-- admin_action_approvals stores a *pending intent*: the payload the requester submitted, who
-- asked, and who approved. The action executes only when a DIFFERENT admin approves, and the
-- executing route re-validates the payload rather than trusting the row. Storing the payload
-- rather than replaying the original HTTP request keeps the approval reviewable — an approver
-- has to be able to read what they are agreeing to.
--
-- Requests EXPIRE. An approval queue with no expiry becomes a pile of stale intents that
-- someone eventually rubber-stamps months later against changed circumstances.
--
-- WHY BREAK-GLASS IS A SEPARATE TABLE FROM ELEVATION
-- -------------------------------------------------
-- Both grant temporary scopes. They differ in what they cost the person using them:
-- an elevation is granted BY someone else (a second admin decides you need finance for an
-- afternoon), while break-glass is SELF-granted with a mandatory justification and fires an
-- alert. Folding them together would let a self-grant hide among ordinary grants in review,
-- which is the one thing break-glass must never do.
--
-- ADMIN SESSION HISTORY IS SAMPLED, NOT LOGGED PER REQUEST
-- -------------------------------------------------------
-- One row per (admin wallet, session token, IP) with a moving last_seen_at, upserted at most
-- once per process per few minutes. A row per authenticated request would write thousands of
-- rows an hour on a connection-limited pooler and answer no question the sampled shape does
-- not: "which sessions, from where, and when were they last active".
--
-- All statements idempotent, one transaction, RLS deny-all — matching
-- 20260812120000_withdrawal_holds.sql.

-- ---------------------------------------------------------------------------
-- 1. Scopes on the delegated admin roster
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_wallets
    -- Closed vocabulary, validated in src/lib/admin/scopes.ts. No CHECK constraint on the
    -- element values on purpose: adding a scope to the code would then need a migration to
    -- match, and a deploy that shipped the code first would refuse every grant.
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}',
    -- NULL = permanent, matching banned_accounts and withdrawal_holds. A timestamp makes the
    -- grant lapse on its own; readers MUST apply it (see isAdminWallet).
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    -- Why this person has console access at all. Distinct from `label`, which is a display name.
    ADD COLUMN IF NOT EXISTS grant_reason TEXT,
    -- True for rows that predate scoping and were backfilled wide. Purely informational: the
    -- console surfaces it so an operator can narrow these deliberately.
    ADD COLUMN IF NOT EXISTS legacy_full_scope BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve today's effective authority exactly. See the note above.
UPDATE public.admin_wallets
   SET scopes = ARRAY['read', 'support', 'compliance', 'risk', 'finance', 'engineering'],
       legacy_full_scope = true
 WHERE scopes = '{}';

-- Live-admin lookups filter on expiry, so the roster read stays a single index scan as
-- lapsed grants accumulate.
CREATE INDEX IF NOT EXISTS idx_admin_wallets_expires_at
    ON public.admin_wallets (expires_at)
    WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Time-boxed elevation — scopes granted to an admin for a bounded window
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_elevations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet       TEXT NOT NULL,              -- lowercased, enforced by the writer
    scopes       TEXT[] NOT NULL,
    granted_by   TEXT NOT NULL,              -- a DIFFERENT admin; the route refuses self-grants
    reason       TEXT NOT NULL,              -- mandatory: the whole point is a reviewable record
    -- Bounded by construction. The route caps the window (see MAX_ELEVATION_HOURS) so an
    -- "elevation" cannot be written as a permanent grant through the back door.
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    revoked_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot read: "what extra scopes does this wallet hold right now". Partial on live rows so
-- expired elevations do not widen it.
CREATE INDEX IF NOT EXISTS idx_admin_elevations_live
    ON public.admin_elevations (wallet, expires_at DESC)
    WHERE revoked_at IS NULL;

ALTER TABLE public.admin_elevations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_elevations" ON public.admin_elevations;
CREATE POLICY "Deny all public access on admin_elevations" ON public.admin_elevations FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 3. Dual control — a pending intent awaiting a second admin
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_action_approvals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- One of ADMIN_ACTIONS. Not a foreign key to anything: the taxonomy lives in code and
    -- rows must survive an action being retired from the list.
    action        TEXT NOT NULL,
    -- What the action will touch, for display and for the duplicate guard below. Free-form
    -- because targets are heterogeneous (a wallet, a receipt id, a merchant address).
    target        TEXT,
    -- The exact arguments the executing route will re-validate. An approver must be able to
    -- read what they are agreeing to, so this is the reviewable copy, not an opaque blob.
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_by  TEXT NOT NULL,
    request_reason TEXT NOT NULL,
    -- 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED'
    status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED', 'CANCELLED')),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT,
    executed_at   TIMESTAMPTZ,
    execute_error TEXT,
    -- Stale intents must not be approvable. See the note above.
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The approver must not be the requester. Enforced in SQL as well as in the route, because
    -- this is the single constraint the whole control rests on and a route is one refactor away
    -- from losing it.
    CONSTRAINT admin_action_approvals_no_self_approval
        CHECK (decided_by IS NULL OR lower(decided_by) <> lower(requested_by))
);

CREATE INDEX IF NOT EXISTS idx_admin_action_approvals_queue
    ON public.admin_action_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_approvals_requester
    ON public.admin_action_approvals (requested_by, created_at DESC);

-- One live request per (action, target). Without this, an impatient requester submits the same
-- ban three times and a distracted approver grants all three, which for a money action means
-- three refunds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_action_approvals_pending_target
    ON public.admin_action_approvals (action, lower(coalesce(target, '')))
    WHERE status IN ('PENDING', 'APPROVED');

ALTER TABLE public.admin_action_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_action_approvals" ON public.admin_action_approvals;
CREATE POLICY "Deny all public access on admin_action_approvals" ON public.admin_action_approvals FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 4. Break-glass — self-granted, justified, alerted
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_break_glass_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet        TEXT NOT NULL,
    scopes        TEXT[] NOT NULL,
    -- Mandatory and length-floored by the route. "urgent" is not a justification; the point of
    -- break-glass is that the written reason is what an auditor reads six months later.
    justification TEXT NOT NULL,
    -- Short by construction (route caps it). Break-glass that lasts a week is just a grant.
    expires_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,
    -- NULL means the alert never went out — itself a finding, so it is stored rather than
    -- assumed. Never overwritten with a lie: a failed send leaves this NULL.
    alert_sent_at TIMESTAMPTZ,
    alert_error   TEXT,
    ip            TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_break_glass_live
    ON public.admin_break_glass_sessions (wallet, expires_at DESC)
    WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_admin_break_glass_created
    ON public.admin_break_glass_sessions (created_at DESC);

ALTER TABLE public.admin_break_glass_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_break_glass_sessions" ON public.admin_break_glass_sessions;
CREATE POLICY "Deny all public access on admin_break_glass_sessions" ON public.admin_break_glass_sessions FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 5. Admin session history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet         TEXT NOT NULL,
    -- SHA-256 of the session token, never the token. Matches sessions.token, which also stores
    -- a hash — an admin session table holding live bearer tokens would be a credential store.
    session_hash   TEXT NOT NULL,
    ip             TEXT,
    user_agent     TEXT,
    -- Which tier and scopes the session was seen acting with. Recorded per session because a
    -- wallet's scopes change over time and "what could this session do" is the audit question.
    tier           TEXT NOT NULL DEFAULT 'delegated',
    scopes         TEXT[] NOT NULL DEFAULT '{}',
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count  INTEGER NOT NULL DEFAULT 1,
    UNIQUE (session_hash, ip)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_wallet
    ON public.admin_sessions (wallet, last_seen_at DESC);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_sessions" ON public.admin_sessions;
CREATE POLICY "Deny all public access on admin_sessions" ON public.admin_sessions FOR ALL USING (false);
