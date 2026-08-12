-- Per-account withdrawal holds: freeze money leaving one wallet without banning it.
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- The console could already ban an account outright (banned_accounts, added in
-- 20260810120000). A ban is the wrong instrument for a payout dispute: it invalidates
-- every session on the next authenticated request, so the account cannot sign in,
-- cannot read its own receipts, and cannot answer the questions the hold was opened to
-- ask. Chargeback review, a suspected drainer, and a compliance freeze all need the
-- opposite shape — the account keeps working, only the exits close.
--
-- SCOPE. One address can be both a merchant and a user (a merchant that also pays for
-- things is one wallet with an account_roles row of each kind), and the two withdraw
-- through different endpoints: users pull escrow back via /api/user/vault/withdraw,
-- merchants pull settled usage via /api/merchant/vault/claim. A single boolean would
-- force an operator freezing a merchant payout to also freeze that person's unrelated
-- consumer refunds, so scope names which exits close:
--   USER     — vault withdrawals only
--   MERCHANT — merchant claims only
--   BOTH     — every exit
--
-- expires_at mirrors banned_accounts: NULL is indefinite, a timestamp lapses on its own.
-- Readers MUST apply it (see assertWithdrawalAllowed in @/lib/admin/withdrawalHolds) —
-- storing an expiry that nothing honours is worse than having no expiry column, because
-- the console would show a hold as temporary while it silently held forever.
--
-- FAIL CLOSED. Unlike the platform flags in 20260810150000, which fail OPEN so a database
-- blip cannot take the product down, a hold that cannot be read must block the withdrawal.
-- The two are not inconsistent: failing open on a kill switch costs a feature staying on
-- for a few seconds, whereas failing open here lets money leave an account that an
-- operator froze — the exact event the hold exists to prevent, and the only one here that
-- cannot be undone.
--
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS before
-- CREATE POLICY), matching 20260810120000_admin_console_foundations.sql. One transaction.

CREATE TABLE IF NOT EXISTS public.withdrawal_holds (
    address    TEXT PRIMARY KEY,          -- lowercased wallet address, enforced by the writer
    scope      TEXT NOT NULL DEFAULT 'BOTH' CHECK (scope IN ('USER', 'MERCHANT', 'BOTH')),
    reason     TEXT,                      -- shown to the operator, never to the held account
    placed_by  TEXT NOT NULL,             -- admin wallet who placed the hold
    expires_at TIMESTAMPTZ,               -- NULL = until an admin lifts it
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordering for the console's Moderation list. Lookups on the withdrawal path are by
-- primary key, so they need no index of their own.
CREATE INDEX IF NOT EXISTS idx_withdrawal_holds_created_at
    ON public.withdrawal_holds (created_at DESC);

ALTER TABLE public.withdrawal_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on withdrawal_holds" ON public.withdrawal_holds;
CREATE POLICY "Deny all public access on withdrawal_holds" ON public.withdrawal_holds FOR ALL USING (false);
