-- Commit ID rotation, and a self-halt a user can apply to their own root commit.
--
-- Two gaps this closes, both consequences of the same fact: a Commit ID is a bearer credential.
-- See the header of src/lib/vaultCommitSharing.ts — "the Commit ID is the whole credential they
-- paste into the platform" — and claimSubUser in src/lib/commitId.ts, where the same 10 chars
-- double as the invite token.
--
-- 1. ROTATION. A leaked Commit ID could previously only be answered with revokeSubUser, which is
--    deliberately terminal, so a leak cost the delegation, its spend ledger and a re-onboard.
--    Rotation is possible without any of that because commit_id is a UNIQUE column distinct from
--    the row's id: parent_commit_id, spend_limit_usdc and spent_usdc all hang off id, so writing
--    a new commit_id keeps identity, cap and ledger intact. Nothing here changes the ID format —
--    the CHECK on commit_id still pins `cmt_` plus 10 Crockford base32 chars.
--
--    commit_id_rotated_at records the last rotation. It exists so the dashboard can say when the
--    old ID stopped working, which is the one question a re-credentialed delegate asks.
--
-- 2. SELF-HALT. Pause was already well built (pauseSubUser plus the recursive-CTE cascade in
--    findInactiveAncestor), but every path ran through requireOwnedSubUser, so only a PARENT
--    could pause a CHILD. A user had no way to stop their own outbound money short of cancelling
--    every subscription one at a time, which is destructive and slow.
--
--    HALTED is a fourth value on the existing status column rather than a separate boolean. The
--    reason is the SQL already in place: findInactiveAncestor and recordSubUserSpend's atomic
--    UPDATE both test `status <> 'ACTIVE'`, so a HALTED root cascades to every delegate beneath
--    it and blocks their debits with no change to either statement. A separate column would have
--    to be threaded through both recursive CTEs, and one of them is the cap enforcement itself.
--    Reusing the column also keeps the state machine in one place instead of two that can
--    disagree.
--
--    Only a root may be HALTED. A delegate stopping itself is what PAUSED already means, and
--    letting a child hold HALTED would give two names to one state.
--
-- Scope: this migration touches only public.user_commits. See
-- 20260808120000_add_user_commit_framework.sql for the table and why its CHECK constraints live
-- in SQL rather than in the Prisma model.

-- Rotation audit stamp. Nullable: a commit that has never been rotated has nothing to report.
ALTER TABLE public.user_commits
    ADD COLUMN IF NOT EXISTS commit_id_rotated_at TIMESTAMPTZ;

-- Its own timestamp rather than reusing paused_at. paused_at means "a parent stopped this
-- delegate", halted_at means "the account holder stopped themselves", and the console shows the
-- two differently. Cleared on resume, so status stays the single authority on whether a halt is
-- in force.
ALTER TABLE public.user_commits
    ADD COLUMN IF NOT EXISTS halted_at TIMESTAMPTZ;

-- Widen the status domain. Dropped and re-added rather than altered because Postgres has no
-- in-place edit for a CHECK expression.
ALTER TABLE public.user_commits
    DROP CONSTRAINT IF EXISTS user_commits_status_check;

ALTER TABLE public.user_commits
    ADD CONSTRAINT user_commits_status_check
    CHECK (status IN ('ACTIVE', 'PAUSED', 'HALTED', 'REVOKED'));

-- Keep the timestamps honest about the status they describe, now including HALTED. A halt is
-- reversible, so like PAUSED it must carry no revoked_at.
ALTER TABLE public.user_commits
    DROP CONSTRAINT IF EXISTS user_commits_status_timestamps;

ALTER TABLE public.user_commits
    ADD CONSTRAINT user_commits_status_timestamps CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'PAUSED' AND paused_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'HALTED' AND halted_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    );

-- A halt is an account-level act, so it may only land on a root commit. A delegate that should
-- stop is PAUSED by its parent; giving a child HALTED would mean two names for one state and
-- would let a capped delegate present itself as a halted account.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_commits_halt_root_only'
    ) THEN
        ALTER TABLE public.user_commits
            ADD CONSTRAINT user_commits_halt_root_only
            CHECK (status <> 'HALTED' OR parent_commit_id IS NULL);
    END IF;
END $$;

-- The halt read sits in front of every outbound-money path (see src/lib/accountHalt.ts), so it
-- runs far more often than the sub-user listing this table was indexed for. A partial index keeps
-- it to one small scan even though halted accounts are a rounding error in the row count.
CREATE INDEX IF NOT EXISTS user_commits_halted_root_idx
    ON public.user_commits (wallet_address)
    WHERE status = 'HALTED' AND parent_commit_id IS NULL;
