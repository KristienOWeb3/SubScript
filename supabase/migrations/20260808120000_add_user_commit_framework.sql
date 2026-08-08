-- Commit IDs: SubScript's spending-identity primitive.
--
-- Every user wallet owns exactly one root commit, allocated lazily on first use (no backfill).
-- A root commit can own sub-user commits, each with an optional display name, an optional wallet
-- address, and an optional USDC spend cap. Authority to pause or revoke is proven by the parent
-- wallet owning the target's parent commit, so siblings cannot act on each other.
--
-- Mirrors model UserCommit in prisma/schema.prisma — keep the two in step.
-- Idempotent: safe to re-run against a database that already has the table.

CREATE TABLE IF NOT EXISTS public.user_commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- `cmt_` + 10 Crockford base32 chars (I, L, O, U omitted so an ID cannot be mis-transcribed
    -- into another valid one). Generated in app code; the CHECK keeps malformed IDs out of the
    -- table even if a future caller bypasses generateCommitId().
    commit_id TEXT NOT NULL UNIQUE
        CHECK (commit_id ~ '^cmt_[0123456789abcdefghjkmnpqrstvwxyz]{10}$'),

    -- Null while a sub-user is invited but not yet provisioned a wallet. Root commits always
    -- carry one, and the unique constraint keeps it to one commit per wallet.
    wallet_address TEXT UNIQUE,
    -- Unbounded text, matching `displayName String?` in the Prisma model. Deliberately no
    -- length CHECK: the POST /api/user/commit/sub-users handler does not cap the incoming
    -- string, so a constraint here would surface as an opaque 500 rather than a 400.
    display_name TEXT,

    -- Self-referencing hierarchy. ON DELETE CASCADE matches the Prisma relation: deleting a
    -- parent tears down the delegations beneath it rather than orphaning them.
    parent_commit_id UUID
        REFERENCES public.user_commits(id) ON DELETE CASCADE,

    -- USDC 6-decimals, BIGINT like the rest of the money columns. Null on root commits (the
    -- wallet owner spends their own balance) and on uncapped children.
    spend_limit_usdc BIGINT
        CHECK (spend_limit_usdc IS NULL OR spend_limit_usdc >= 0),
    spent_usdc BIGINT NOT NULL DEFAULT 0
        CHECK (spent_usdc >= 0),

    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED')),
    paused_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A commit cannot be its own parent. Deeper cycles are impossible in practice because a
    -- parent is always an existing row and children are created beneath it.
    CONSTRAINT user_commits_no_self_parent CHECK (parent_commit_id IS NULL OR parent_commit_id <> id),

    -- Root commits spend the wallet's own balance, so a cap on one would be silently ignored by
    -- validateSubUserCanSpend(). Reject it at write time rather than letting it mislead.
    CONSTRAINT user_commits_root_uncapped CHECK (parent_commit_id IS NOT NULL OR spend_limit_usdc IS NULL),

    -- Keep the timestamps honest about the status they describe.
    CONSTRAINT user_commits_status_timestamps CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'PAUSED' AND paused_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    )
);

-- Listing a parent's sub-users, optionally filtered by status, is the hot read.
CREATE INDEX IF NOT EXISTS user_commits_parent_status_idx
    ON public.user_commits (parent_commit_id, status);

-- Server-only table: written and read exclusively through the service role, which bypasses RLS.
-- Explicit deny-all matches the rest of the schema and clears the Supabase advisor's
-- "RLS enabled, no policy" finding.
ALTER TABLE public.user_commits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access" ON public.user_commits;
CREATE POLICY "Deny all public access"
    ON public.user_commits
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON TABLE public.user_commits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_commits TO service_role;
