-- Auto top-up for metered vaults: a user-granted, bounded mandate to refill a
-- (user -> merchant) escrow without the user present.
--
-- WHY THIS EXISTS
-- ---------------
-- A metered vault drains as the merchant reports usage. At zero the service pauses, the user
-- gets a COMMIT_EXHAUSTED DM, and nothing resumes until they open the dashboard and re-commit
-- by hand. Service interruption is therefore the DEFAULT outcome of normal usage, not an
-- exceptional one. This migration adds the state a keeper needs to refill the vault first.
--
-- THE COLUMNS THIS TABLE ALREADY HAD
-- ----------------------------------
-- threshold_usdc / top_up_amount_usdc / monthly_limit_usdc / monthly_spent_usdc / last_top_up_at
-- have existed (with defaults) since the table was created, and are already serialized by
-- /api/user/vault/config. NOTHING has ever read them: POST on that route is a 410 tombstone, so
-- the values were unreachable defaults. They become live here. That is also why the defaults
-- below matter -- every existing row already carries 2 / 10 / 50 USDC.
--
-- CONSENT MODEL (read this before changing any gate)
-- --------------------------------------------------
-- The server holds Circle MPC signing authority over custodial wallets, so "the server can
-- sign" is never the question -- the question is what bounds it. Three bounds, deliberately
-- layered so no single bug removes the ceiling:
--
--   1. auto_topup_enabled       -- defaults FALSE. The user must turn this on explicitly.
--                                  A vault that has never been configured can never be debited.
--   2. monthly_limit_usdc       -- enforced off-chain against monthly_spent_usdc, which resets
--                                  on a calendar-month boundary anchored by monthly_window_start.
--                                  This is the PRECISE per-vault cap.
--   3. auto_topup_allowance_usdc -- mirrors a real ERC-20 approve(vault, monthly_limit) signed
--                                  when the mandate is granted. This is the HARD ceiling: it is
--                                  enforced by the chain, survives any application bug, and the
--                                  user can revoke it from any wallet UI without our cooperation.
--
-- Layer 3 is coarse (the allowance is per (owner, spender), so manual commits draw on the same
-- pool) and layer 2 is exact. Both are checked before every unattended commit.
--
-- topup_due_at is an ARMING FLAG, not a schedule. report-usage sets it inside the UPDATE it was
-- already issuing, so the merchant's hot path pays nothing for it; the keeper does all signing.
-- The keeper clears it, including when it finds the vault no longer low -- that self-heals the
-- case where the user topped up manually between arming and the sweep.

ALTER TABLE public.metered_vaults
    ADD COLUMN IF NOT EXISTS auto_topup_enabled        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS auto_topup_consent_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS auto_topup_allowance_usdc BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_window_start      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS topup_due_at              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS auto_topup_failure_code   TEXT,
    ADD COLUMN IF NOT EXISTS auto_topup_failed_at      TIMESTAMPTZ;

COMMENT ON COLUMN public.metered_vaults.auto_topup_enabled IS
    'User-granted mandate to refill this vault unattended. FALSE unless explicitly enabled.';
COMMENT ON COLUMN public.metered_vaults.auto_topup_allowance_usdc IS
    'Micro-USDC approved on-chain to the vault when the mandate was granted -- the hard ceiling.';
COMMENT ON COLUMN public.metered_vaults.topup_due_at IS
    'Armed by report-usage when remaining < threshold. Cleared by the keeper. NULL = not due.';

-- Clamp any row that would violate the invariants below. Today this is a no-op (nothing has ever
-- written these columns), but the migration must not be able to fail on a row it did not create.
UPDATE public.metered_vaults
   SET threshold_usdc = 2000000
 WHERE threshold_usdc <= 0;

UPDATE public.metered_vaults
   SET top_up_amount_usdc = 2000000
 WHERE top_up_amount_usdc < 2000000;

UPDATE public.metered_vaults
   SET monthly_limit_usdc = top_up_amount_usdc
 WHERE monthly_limit_usdc < top_up_amount_usdc;

UPDATE public.metered_vaults
   SET threshold_usdc = top_up_amount_usdc
 WHERE threshold_usdc > top_up_amount_usdc;

UPDATE public.metered_vaults
   SET monthly_spent_usdc = 0
 WHERE monthly_spent_usdc < 0;

-- Named CHECKs, guarded because ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS.
-- These are the invariants the keeper relies on and must NOT be recreated by `prisma migrate`
-- (see the warning above model UserCommit in schema.prisma -- Prisma does not know about them).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_threshold_positive'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_threshold_positive
            CHECK (threshold_usdc > 0);
    END IF;

    -- A chunk below STANDARD_COMMIT (2 USDC) can never satisfy the contract's activation rule
    -- (owed == 0 AND balance >= STANDARD_COMMIT), so the vault would stay inactive, stay armed,
    -- and the keeper would refill it forever without ever restoring service. Reject at the DB.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_topup_amount_min_commit'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_topup_amount_min_commit
            CHECK (top_up_amount_usdc >= 2000000);
    END IF;

    -- A cap below one chunk means every top-up is rejected on the cap check: an enabled mandate
    -- that can never fire is worse than a disabled one, because the UI would show it as armed.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_monthly_limit_covers_topup'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_monthly_limit_covers_topup
            CHECK (monthly_limit_usdc >= top_up_amount_usdc);
    END IF;

    -- TERMINATION INVARIANT. After one refill the remaining balance is at least top_up_amount, so
    -- threshold <= top_up_amount proves the vault is no longer low and disarms. Without it, a
    -- vault whose deficit exceeds one chunk stays below the threshold after refilling, re-arms on
    -- the next usage report, and tops up on every sweep until the monthly cap absorbs it. This is
    -- the constraint that bounds unattended spending in the pathological case, so it is enforced
    -- here as well as in validateMandate().
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_threshold_within_topup'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_threshold_within_topup
            CHECK (threshold_usdc <= top_up_amount_usdc);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_monthly_spent_nonneg'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_monthly_spent_nonneg
            CHECK (monthly_spent_usdc >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_auto_topup_allowance_nonneg'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_auto_topup_allowance_nonneg
            CHECK (auto_topup_allowance_usdc >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'metered_vaults_auto_topup_failure_code'
          AND conrelid = 'public.metered_vaults'::regclass
    ) THEN
        ALTER TABLE public.metered_vaults
            ADD CONSTRAINT metered_vaults_auto_topup_failure_code
            CHECK (auto_topup_failure_code IS NULL OR auto_topup_failure_code IN (
                'EXTERNAL_WALLET',
                'INSUFFICIENT_WALLET_BALANCE',
                'ALLOWANCE_EXHAUSTED',
                'MONTHLY_CAP_REACHED',
                'VAULT_DISPUTED',
                'COMMIT_FAILED'
            ));
    END IF;
END
$$;

-- The keeper's only hot query. Partial, because the armed set is a tiny fraction of all vaults
-- and stays tiny: a row is armed for at most one sweep interval before the keeper clears it.
CREATE INDEX IF NOT EXISTS metered_vaults_topup_due_idx
    ON public.metered_vaults (topup_due_at)
    WHERE auto_topup_enabled AND topup_due_at IS NOT NULL;
