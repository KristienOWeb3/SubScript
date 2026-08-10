-- Runtime platform flags: kill switches an admin can flip without a redeploy.
--
-- WHY THIS TABLE EXISTS
-- --------------------
-- Three features need to be pausable during an incident:
--
--   google_signin_enabled  — Continue-with-Google. Previously ONLY controlled by
--                            NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED, which is inlined into the
--                            client bundle at BUILD time. Turning it off meant editing a
--                            Vercel env var and waiting for a full redeploy — useless when
--                            the Circle/Google path is actively failing for users.
--
--   maintenance_enabled    — "SubScript is temporarily down". Blocks the app while leaving
--                            the admin console reachable, so the operator who enabled it can
--                            always turn it back off. See the exemption list in middleware.
--
--   external_wallet_enabled — Connect-external-wallet (MetaMask etc). Lets us fall back to
--                            embedded/custodial wallets only, if an external-wallet path
--                            starts producing bad signatures or failed settlements.
--
-- Single row (id = 1) enforced by a CHECK constraint, matching the existing system_settings
-- convention in this codebase. A singleton avoids the "which row is live?" ambiguity that a
-- key/value flags table invites, and lets readers fetch every flag in one query.
--
-- FAIL-OPEN, DELIBERATELY. Consumers treat an unreadable table as "all features enabled,
-- not in maintenance". A database blip must never black out the site or lock out sign-in —
-- the failure mode of a flags system should be "flags don't apply", not "everything stops".
-- The one exception is google_signin_enabled, which its consumer fails CLOSED: hiding a
-- sign-in button degrades gracefully, whereas showing one that always errors does not.
--
-- RLS deny-all: written and read only by the server (service role), never by the browser.

CREATE TABLE IF NOT EXISTS public.platform_flags (
    id                      INT PRIMARY KEY DEFAULT 1 CONSTRAINT platform_flags_single_row CHECK (id = 1),
    google_signin_enabled   BOOLEAN NOT NULL DEFAULT false,
    maintenance_enabled     BOOLEAN NOT NULL DEFAULT false,
    maintenance_message     TEXT,
    external_wallet_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              TEXT NOT NULL DEFAULT 'system'
);

ALTER TABLE public.platform_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on platform_flags" ON public.platform_flags;
CREATE POLICY "Deny all public access on platform_flags" ON public.platform_flags FOR ALL USING (false);

-- Seed the singleton. google_signin_enabled defaults to FALSE to preserve current production
-- behaviour: NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED is unset in every env file, so the button is
-- already hidden. Seeding it true here would silently switch Google sign-in ON at deploy.
INSERT INTO public.platform_flags (id, google_signin_enabled, maintenance_enabled, external_wallet_enabled)
VALUES (1, false, false, true)
ON CONFLICT (id) DO NOTHING;
