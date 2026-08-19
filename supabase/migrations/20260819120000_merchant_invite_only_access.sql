-- Invite-only merchant accounts: admin-granted merchant access, keyed by email.
--
-- WHY THIS EXISTS
-- ---------------
-- Merchant signup used to be open: anyone could pick "Enterprise Merchant" on /signup. The only
-- gate was ALLOW_PUBLIC_MERCHANT_SIGNUP="false" plus a single shared MERCHANT_SIGNUP_CODE — one
-- code for every merchant, pasteable into any invite link, unrevocable without a redeploy.
--
-- For mainnet, a merchant account is something an admin grants to one business:
--
--   merchant_access_requests  — the front door. A business submits its email and details; an
--                               admin approves or declines. Kept separate from waitlist_leads
--                               because those are marketing leads with no decision state, and
--                               conflating "wants to hear from us" with "may open a merchant
--                               account" is exactly the mistake this table prevents.
--
--   merchant_access_grants    — the authority. One row per email that may open a merchant
--                               account. /api/auth/register-role checks this against the wallet's
--                               VERIFIED email (user_embedded_wallets.email_verified_at), never
--                               against anything the client posted.
--
-- THE EMAIL IS THE AUTHORITY, THE TOKEN IS NOT.
-- invite_token exists so an admin can hand a business a working link
-- (/signup?role=merchant&invite=<token>). It is a convenience and an audit trail, NOT a
-- credential: the server still requires the grant to match the verified email, so a forwarded or
-- leaked link cannot open a merchant account for anyone else. That is why the token is stored in
-- plaintext rather than hashed — the console needs to re-display the link, and there is no
-- privilege to protect by hashing it. Same reasoning as api_keys.secret_key_plain, except here
-- the plaintext genuinely grants nothing on its own.
--
-- NO UPGRADE PATH. A USER account can never become a merchant account: register-role refuses a
-- role change outright, so granting an email that already has an account would create a grant
-- that can never be redeemed. The admin grant route rejects that case up front and tells the
-- operator to have the business use a different email.
--
-- ENFORCEMENT IS OFF AT LAUNCH. merchant_invite_only_enabled defaults FALSE, so applying this
-- migration changes nothing about how signup behaves today. It is a mainnet control, flipped from
-- the admin console (root admins only) when the time comes. Its reader FAILS CLOSED — see the
-- comment on isMerchantInviteOnlyEnforced in src/lib/merchants/accessGrants.ts for why this one
-- flag inverts the fail-open posture of every other row in platform_flags.
--
-- RLS deny-all on both tables: written and read only by the server (service role), never the
-- browser. The public request form goes through a rate-limited, captcha-gated route.

CREATE TABLE IF NOT EXISTS public.merchant_access_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Lowercased by the route via normalizeAccountEmail. UNIQUE so a business that submits twice
    -- updates its own row instead of stacking duplicates in the review queue.
    email         TEXT NOT NULL UNIQUE,
    company_name  TEXT,
    website       TEXT,
    contact_name  TEXT,
    use_case      TEXT,
    monthly_volume TEXT,
    status        TEXT NOT NULL DEFAULT 'PENDING'
                  CONSTRAINT merchant_access_requests_status_check
                  CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED')),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT,
    -- Kept for abuse forensics only. The route rate-limits on a digest of the IP; this column is
    -- what an operator looks at when one actor floods the queue from many addresses.
    ip            TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The console's default view is "pending, newest first".
CREATE INDEX IF NOT EXISTS merchant_access_requests_status_created_idx
    ON public.merchant_access_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.merchant_access_grants (
    -- Email as the primary key, not a surrogate id: one grant per email is the invariant, and
    -- making it the key means the database enforces it rather than application code.
    email         TEXT PRIMARY KEY,
    granted_by    TEXT NOT NULL,
    -- Nullable: an admin can grant an email that never filed a request (a business that reached
    -- us on X, say). UNIQUE because a request approves into at most one grant. ON DELETE SET NULL
    -- so pruning old requests never destroys a live grant.
    request_id    UUID UNIQUE REFERENCES public.merchant_access_requests (id) ON DELETE SET NULL,
    invite_token  TEXT NOT NULL UNIQUE,
    invite_sent_at TIMESTAMPTZ,
    -- Set when the grant is actually redeemed into a merchant account. Retained rather than
    -- deleted so "who claimed this, and when" survives; also makes a repeat signup from the same
    -- wallet an idempotent retry instead of a refusal.
    claimed_at    TIMESTAMPTZ,
    claimed_wallet TEXT,
    revoked_at    TIMESTAMPTZ,
    revoked_by    TEXT,
    revoke_reason TEXT,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_access_grants_invite_token_idx
    ON public.merchant_access_grants (invite_token);
CREATE INDEX IF NOT EXISTS merchant_access_grants_created_idx
    ON public.merchant_access_grants (created_at DESC);

ALTER TABLE public.merchant_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on merchant_access_requests" ON public.merchant_access_requests;
CREATE POLICY "Deny all public access on merchant_access_requests" ON public.merchant_access_requests FOR ALL USING (false);

ALTER TABLE public.merchant_access_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on merchant_access_grants" ON public.merchant_access_grants;
CREATE POLICY "Deny all public access on merchant_access_grants" ON public.merchant_access_grants FOR ALL USING (false);

-- The switch. FALSE means today's open self-serve merchant signup, unchanged.
ALTER TABLE public.platform_flags
    ADD COLUMN IF NOT EXISTS merchant_invite_only_enabled BOOLEAN NOT NULL DEFAULT false;
