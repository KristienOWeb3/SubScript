-- Account-level and content-level moderation levers between "nothing" and "ban".
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Sections 2.1 and 2.4 of docs/admin-capabilities-audit.md were almost entirely empty. Staff had
-- two settings for an account — untouched, or banned — and a ban kills every session, so it
-- cannot be used for anything short of "this person is gone". Everything in between (stop this
-- account opening new subscriptions while a dispute runs, take down one abusive DM, remove an
-- impersonating alias) had no lever at all, which in practice means the answer to a small abuse
-- report is either nothing or the largest hammer available.
--
-- WHAT IS *NOT* HERE, DELIBERATELY
-- --------------------------------
-- Temporary suspension needed no table. banned_accounts.expires_at has existed since the bans
-- feature shipped and getVerifiedSessionToken already honours it
-- ("b.expires_at is null or b.expires_at > now()"), so a temporary ban was one unused column
-- away the whole time — the route simply never set it. That is a route and console change, not
-- a schema one. Adding a second suspensions table would have created two answers to "is this
-- account locked out" with only one of them enforced.
--
-- WHY RESTRICTIONS ARE (address, feature) ROWS AND NOT COLUMNS ON customers
-- ------------------------------------------------------------------------
-- The set of restrictable features grows (no new subscriptions, no new vault commits, no
-- messaging, no withdrawals, no alias changes) and each one needs its own reason, actor, and
-- expiry. As columns that is five columns per feature and a migration per new lever; as rows it
-- is one insert. The feature vocabulary is validated in code (ACCOUNT_RESTRICTIONS in
-- src/lib/admin/accountRestrictions.ts) for the same reason scopes are: a CHECK constraint would
-- make adding a lever a two-deploy operation.
--
-- WHY A TAKEDOWN IS A ROW RATHER THAN A DELETE
-- -------------------------------------------
-- Deleting a merchant's plan, a DM, or a profile picture destroys the evidence for the takedown
-- along with the content. Every reader instead joins against content_takedowns, so the row is
-- hidden while the record of who hid it and why survives — and a mistaken takedown is one
-- `restored_at` away from reversal. This is the same reasoning as receipts keeping cancelled
-- rows: in a payments product the audit trail outlives the object.
--
-- IMPERSONATION IS READ-ONLY AND SHORT-LIVED BY CONSTRUCTION
-- ---------------------------------------------------------
-- The token here grants a *view*, never a session. It cannot sign, subscribe, withdraw, or
-- message; the routes that honour it are read-only by allowlist. It expires in minutes, names
-- the subject, and carries a mandatory reason — support looking at what a user sees should be
-- cheap, and acting as them should be impossible.
--
-- All statements idempotent, one transaction, RLS deny-all.

-- ---------------------------------------------------------------------------
-- 1. Per-feature account restrictions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_restrictions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address     TEXT NOT NULL,             -- lowercased wallet, enforced by the writer
    -- Validated in code, not by CHECK. See the note above.
    feature     TEXT NOT NULL,
    reason      TEXT NOT NULL,             -- mandatory; this is someone's account being narrowed
    placed_by   TEXT NOT NULL,
    expires_at  TIMESTAMPTZ,               -- NULL = until lifted
    lifted_at   TIMESTAMPTZ,
    lifted_by   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live restriction per (address, feature). A second insert re-scopes the first rather than
-- stacking, so lifting a restriction cannot leave a forgotten duplicate still enforcing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_restrictions_live
    ON public.account_restrictions (address, feature)
    WHERE lifted_at IS NULL;

-- The enforcement read: "what is this address barred from right now".
CREATE INDEX IF NOT EXISTS idx_account_restrictions_address
    ON public.account_restrictions (address, created_at DESC);

ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on account_restrictions" ON public.account_restrictions;
CREATE POLICY "Deny all public access on account_restrictions" ON public.account_restrictions FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 2. Messaging mutes
-- ---------------------------------------------------------------------------
-- Kept apart from account_restrictions even though "no messaging" could have been a feature
-- string, because a mute has a shape the generic table does not: it is the most commonly issued
-- moderation action, the console lists it on its own, and it needs a scope (DM vs payment
-- request) so a merchant muted for harassment can still send legitimate payment requests.

CREATE TABLE IF NOT EXISTS public.messaging_mutes (
    address    TEXT PRIMARY KEY,
    -- 'DM' | 'PAYMENT_REQUEST' | 'ALL'
    scope      TEXT NOT NULL DEFAULT 'ALL' CHECK (scope IN ('DM', 'PAYMENT_REQUEST', 'ALL')),
    reason     TEXT NOT NULL,
    muted_by   TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_mutes_created
    ON public.messaging_mutes (created_at DESC);

ALTER TABLE public.messaging_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on messaging_mutes" ON public.messaging_mutes;
CREATE POLICY "Deny all public access on messaging_mutes" ON public.messaging_mutes FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 3. Content takedowns
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_takedowns (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'MERCHANT_PLAN' | 'PAYMENT_LINK' | 'DM' | 'PROFILE_PIC' | 'DISPLAY_NAME' | 'ALIAS'
    -- | 'RECEIPT_MEMO'. Validated in code (TAKEDOWN_TARGETS) so a new content type needs no
    -- migration.
    target_type  TEXT NOT NULL,
    -- The id in that type's own table: a UUID for a plan or link, an address for a profile.
    -- TEXT rather than UUID because the types are heterogeneous.
    target_id    TEXT NOT NULL,
    -- Who owns the content, so the console can list "everything taken down for this account"
    -- without joining seven tables. Lowercased address; NULL when ownership is unknowable.
    owner_address TEXT,
    reason       TEXT NOT NULL,
    -- A snapshot of what was removed. The whole point of hiding rather than deleting is that
    -- the evidence survives, and for a mutable field (a display name, a memo) the row itself
    -- will have moved on by the time anyone reviews the decision.
    removed_value JSONB,
    actor        TEXT NOT NULL,
    restored_at  TIMESTAMPTZ,
    restored_by  TEXT,
    restore_note TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The enforcement read every content surface makes: "is this object hidden".
CREATE INDEX IF NOT EXISTS idx_content_takedowns_target
    ON public.content_takedowns (target_type, target_id)
    WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_takedowns_owner
    ON public.content_takedowns (owner_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_takedowns_created
    ON public.content_takedowns (created_at DESC);

ALTER TABLE public.content_takedowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on content_takedowns" ON public.content_takedowns;
CREATE POLICY "Deny all public access on content_takedowns" ON public.content_takedowns FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 4. Reserved and seized aliases
-- ---------------------------------------------------------------------------
-- address_aliases is first-come with no admin override, so "paypal.sub" or "subscript.sub" was
-- available to whoever typed it first, and a trademark complaint had no remedy. A reservation
-- blocks a name from ever being claimed; a seizure additionally records who held it, so
-- returning it is possible if the complaint was wrong.

CREATE TABLE IF NOT EXISTS public.alias_reservations (
    alias         TEXT PRIMARY KEY,        -- lowercased, matching address_aliases.alias
    -- 'RESERVED' (never claimable) | 'SEIZED' (taken from a holder)
    kind          TEXT NOT NULL DEFAULT 'RESERVED' CHECK (kind IN ('RESERVED', 'SEIZED')),
    reason        TEXT NOT NULL,
    -- Who held it when it was seized. NULL on a pre-emptive reservation.
    seized_from   TEXT,
    reserved_by   TEXT NOT NULL,
    released_at   TIMESTAMPTZ,
    released_by   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alias_reservations_created
    ON public.alias_reservations (created_at DESC);

ALTER TABLE public.alias_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on alias_reservations" ON public.alias_reservations;
CREATE POLICY "Deny all public access on alias_reservations" ON public.alias_reservations FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 5. Read-only impersonation ("view as user")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_impersonations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_wallet   TEXT NOT NULL,
    subject_address TEXT NOT NULL,
    reason         TEXT NOT NULL,
    -- SHA-256 of the view token, never the token — same posture as sessions and admin_sessions.
    token_hash     TEXT NOT NULL UNIQUE,
    -- Minutes, not hours. Capped by the route.
    expires_at     TIMESTAMPTZ NOT NULL,
    ended_at       TIMESTAMPTZ,
    ip             TEXT,
    -- Which read-only surfaces were actually opened, appended as the session is used. Makes the
    -- record answer "what did support look at" rather than only "support looked".
    viewed_paths   JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Set when a linked support ticket motivated the view, so the two are reviewable together.
    ticket_id      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonations_subject
    ON public.admin_impersonations (subject_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_impersonations_admin
    ON public.admin_impersonations (admin_wallet, created_at DESC);

ALTER TABLE public.admin_impersonations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on admin_impersonations" ON public.admin_impersonations;
CREATE POLICY "Deny all public access on admin_impersonations" ON public.admin_impersonations FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 6. Support ticket -> transaction links
-- ---------------------------------------------------------------------------
-- support_tickets is created imperatively by src/lib/support/tickets.ts rather than by a
-- migration, so this table deliberately carries NO foreign key to it: a FK would make this
-- migration fail on any database where that lazy CREATE TABLE has not run yet. The ticket id is
-- validated by the route instead.

CREATE TABLE IF NOT EXISTS public.support_ticket_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   TEXT NOT NULL,
    -- 'PAYMENT_SESSION' | 'RECEIPT' | 'SUBSCRIPTION' | 'VAULT' | 'DISPUTE' | 'REFUND'
    ref_type    TEXT NOT NULL,
    ref_id      TEXT NOT NULL,
    -- Denormalised so the ticket view can show an amount without six conditional joins.
    amount_usdc BIGINT,
    note        TEXT,
    linked_by   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, ref_type, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_links_ticket
    ON public.support_ticket_links (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_links_ref
    ON public.support_ticket_links (ref_type, ref_id);

ALTER TABLE public.support_ticket_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on support_ticket_links" ON public.support_ticket_links;
CREATE POLICY "Deny all public access on support_ticket_links" ON public.support_ticket_links FOR ALL USING (false);
