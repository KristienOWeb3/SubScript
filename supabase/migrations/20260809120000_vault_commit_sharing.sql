-- Shareable Commit IDs for metered vaults.
--
-- A primary user commits USDC to a merchant (metered_vaults), then shares that commitment with
-- friends. Each friend spends the PRIMARY's escrow — never their own wallet, and without needing
-- a SubScript account at all: they paste a Commit ID into the merchant's platform and the
-- merchant reports usage against it.
--
-- The identity layer is user_commits, extended here with vault_id:
--
--   vault root   vault_id set, parent_commit_id NULL  -- the primary's own handle for the vault
--     └─ friend  vault_id set, parent_commit_id = root, spend_limit_usdc = the primary's cap
--
-- Two deliberate consequences of reusing user_commits:
--
--   * wallet_address stays NULL on every vault-scoped commit. The column is UNIQUE, so a user
--     who commits to several merchants could not hold one root per vault if roots carried it.
--     Authority over a vault commit is therefore proven by metered_vaults.user_address, not by
--     wallet_address on the commit row. Postgres does not collide NULLs in a UNIQUE index.
--
--   * user_commits_root_uncapped already forbids a cap on a root, which is correct here: the
--     committed escrow is the primary's own ceiling. Only friends carry spend_limit_usdc, and
--     each cap is a slice of that same escrow rather than new money.
--
-- Mirrors model UserCommit / MeteredUsageReport in prisma/schema.prisma — keep them in step.
-- As with 20260808120000, the CHECK constraints and the trigger below exist ONLY in this file;
-- regenerating either table from the Prisma client would drop them.

-- Which vault this commit draws from. NULL keeps the pre-existing wallet-delegation rows
-- (root commit per wallet, sub-users spending the parent's wallet) exactly as they were.
-- CASCADE matches the vault relation: tearing down a vault tears down the sharing beneath it.
ALTER TABLE public.user_commits
    ADD COLUMN IF NOT EXISTS vault_id UUID
        REFERENCES public.metered_vaults(id) ON DELETE CASCADE;

-- One root commit per vault. Partial so the wallet-scoped rows (vault_id NULL) are unaffected,
-- and so a vault cannot end up with two competing shareable handles.
CREATE UNIQUE INDEX IF NOT EXISTS user_commits_vault_root_idx
    ON public.user_commits (vault_id)
    WHERE vault_id IS NOT NULL AND parent_commit_id IS NULL;

-- Listing everyone a vault is shared with is the hot read for the dashboard.
CREATE INDEX IF NOT EXISTS user_commits_vault_status_idx
    ON public.user_commits (vault_id, status)
    WHERE vault_id IS NOT NULL;

-- vault_id is denormalised onto children so the dashboard can list a vault's shares in one
-- indexed read instead of walking the hierarchy. That denormalisation is only safe while every
-- child agrees with its parent: a friend row pointing at vault A but parented under vault B's
-- root would debit a cap against the wrong escrow. A CHECK cannot see the parent row, so the
-- invariant is a trigger. It fires on the write that could break it, not on every read.
CREATE OR REPLACE FUNCTION public.enforce_user_commit_vault_lineage()
RETURNS TRIGGER AS $$
DECLARE
    parent_vault_id UUID;
BEGIN
    IF NEW.parent_commit_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT vault_id INTO parent_vault_id
      FROM public.user_commits
     WHERE id = NEW.parent_commit_id;

    IF COALESCE(parent_vault_id::text, '') <> COALESCE(NEW.vault_id::text, '') THEN
        RAISE EXCEPTION
            'user_commits.vault_id (%) must match parent commit %''s vault_id (%)',
            NEW.vault_id, NEW.parent_commit_id, parent_vault_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_enforce_user_commit_vault_lineage
    BEFORE INSERT OR UPDATE OF vault_id, parent_commit_id ON public.user_commits
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_user_commit_vault_lineage();

-- Which commit consumed each usage line, so the primary can see per-friend spend in the ledger
-- and not merely a single undifferentiated total. NULL on the pre-existing rows and on usage the
-- primary drove directly through their own address.
ALTER TABLE public.metered_usage_reports
    ADD COLUMN IF NOT EXISTS commit_id TEXT;

-- Per-friend usage history for a vault, newest first.
CREATE INDEX IF NOT EXISTS metered_usage_reports_commit_idx
    ON public.metered_usage_reports (commit_id, created_at DESC)
    WHERE commit_id IS NOT NULL;
