/*
 * Server-side single-use records for wallet-login (SIWE) nonces. The nonce was previously
 * only round-tripped through a client cookie, so verify-signature compared two
 * attacker-controlled values and a captured signature stayed replayable for as long as the
 * attacker kept re-presenting the same nonce. Nonces are now issued into this table and
 * atomically consumed (DELETE ... RETURNING) on verification.
 */
CREATE TABLE IF NOT EXISTS public.siwe_nonces (
    nonce TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS siwe_nonces_expires_idx
    ON public.siwe_nonces (expires_at);

ALTER TABLE public.siwe_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on siwe_nonces" ON public.siwe_nonces;
CREATE POLICY "Deny all public access on siwe_nonces"
    ON public.siwe_nonces
    FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON TABLE public.siwe_nonces FROM PUBLIC, anon, authenticated;
