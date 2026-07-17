/*
 * Test/live API-key isolation.
 *
 * The platform is testnet-only, but environment isolation must exist BEFORE a live
 * mode is ever introduced. Every API key carries an immutable mode; only TEST keys
 * can be issued on this deployment (LIVE insertion is refused at the database).
 * Financial objects the keys touch record their settlement environment so a TEST
 * key can never mutate a future mainnet object.
 *
 * Also replaces the revoke-then-insert key rotation: the replacement key is created
 * first and old keys are revoked only inside the same transaction, so a failed
 * insert can no longer leave a merchant with zero keys.
 */

ALTER TABLE public.api_keys
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'TEST'
        CHECK (mode IN ('TEST', 'LIVE'));

/* The mode of a key never changes after creation, and this deployment cannot issue
   LIVE keys at all. A future mainnet cutover replaces this trigger deliberately. */
CREATE OR REPLACE FUNCTION public.enforce_api_key_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.mode IS DISTINCT FROM OLD.mode THEN
        RAISE EXCEPTION 'api key mode is immutable';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.mode = 'LIVE' THEN
        RAISE EXCEPTION 'live API keys are not enabled on this deployment';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_enforce_mode ON public.api_keys;
CREATE TRIGGER api_keys_enforce_mode
    BEFORE INSERT OR UPDATE ON public.api_keys
    FOR EACH ROW EXECUTE FUNCTION public.enforce_api_key_mode();

/* Settlement environment on the financial objects API keys mutate. */
ALTER TABLE public.metered_vaults
    ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'TEST'
        CHECK (environment IN ('TEST', 'LIVE')),
    ADD COLUMN IF NOT EXISTS settlement_chain_id BIGINT NOT NULL DEFAULT 5042002,
    ADD COLUMN IF NOT EXISTS disputed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.metered_vaults
    DROP CONSTRAINT IF EXISTS metered_vaults_environment_chain_check;
ALTER TABLE public.metered_vaults
    ADD CONSTRAINT metered_vaults_environment_chain_check
    CHECK (
        (environment = 'TEST' AND settlement_chain_id = 5042002)
        OR (environment = 'LIVE' AND settlement_chain_id = 5042001)
    ) NOT VALID;
ALTER TABLE public.metered_vaults
    VALIDATE CONSTRAINT metered_vaults_environment_chain_check;

/* A wallet pair may exist on both Arc environments, but never twice on the same chain. */
ALTER TABLE public.metered_vaults
    DROP CONSTRAINT IF EXISTS metered_vaults_user_address_merchant_address_key,
    DROP CONSTRAINT IF EXISTS metered_vaults_identity_key;
ALTER TABLE public.metered_vaults
    ADD CONSTRAINT metered_vaults_identity_key
    UNIQUE (user_address, merchant_address, environment, settlement_chain_id);

/* metered_usage_reports.environment is added by
   prisma/migrations/20260717030001_metered_usage_report_environment.sql — that table is
   created in prisma/migrations, and `supabase start` (CI/local) never applies that
   directory. A supabase/ migration must not depend on a prisma/-owned table. */

ALTER TABLE public.payment_reconciliation_events
    ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'TEST'
        CHECK (environment IN ('TEST', 'LIVE'));

/* Atomic key rotation: create-and-validate the replacement first; revoke the old keys
   only in the same transaction. Insert failure rolls back everything, preserving the
   merchant's existing keys. Only cleartext-free columns are accepted. */
CREATE OR REPLACE FUNCTION public.rotate_merchant_api_key(
    p_wallet TEXT,
    p_publishable_key TEXT,
    p_secret_key_hash TEXT,
    p_secret_key_hint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new public.api_keys%ROWTYPE;
BEGIN
    IF p_wallet !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'invalid api key wallet';
    END IF;
    IF p_publishable_key !~ '^pk_test_[0-9a-f]{16,}$' THEN
        RAISE EXCEPTION 'invalid publishable key format';
    END IF;
    IF p_secret_key_hash !~ '^[0-9a-f]{64}$' OR p_secret_key_hint !~ '^sk_test_' THEN
        RAISE EXCEPTION 'invalid secret key material';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_wallet || ':api-keys', 7401));

    INSERT INTO public.api_keys (
        wallet_address, publishable_key, secret_key_hash, secret_key_hint, mode, revoked
    ) VALUES (
        p_wallet, p_publishable_key, p_secret_key_hash, left(p_secret_key_hint, 32), 'TEST', false
    ) RETURNING * INTO v_new;

    UPDATE public.api_keys
    SET revoked = true
    WHERE wallet_address = p_wallet
      AND revoked = false
      AND id <> v_new.id;

    RETURN jsonb_build_object(
        'id', v_new.id,
        'walletAddress', v_new.wallet_address,
        'publishableKey', v_new.publishable_key,
        'mode', v_new.mode,
        'createdAt', v_new.created_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_merchant_api_key(TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_merchant_api_key(TEXT, TEXT, TEXT, TEXT)
    TO service_role, postgres;
