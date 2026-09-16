/*
 * Enable LIVE API keys on mainnet cutover.
 *
 * Allows merchants to generate and rotate LIVE API keys (pk_live_..., sk_live_...)
 * while maintaining backward compatibility for TEST API keys (pk_test_..., sk_test_...).
 * Enforces key mode immutability on UPDATE.
 */

CREATE OR REPLACE FUNCTION public.enforce_api_key_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.mode IS DISTINCT FROM OLD.mode THEN
        RAISE EXCEPTION 'api key mode is immutable';
    END IF;
    IF NEW.mode NOT IN ('TEST', 'LIVE') THEN
        RAISE EXCEPTION 'invalid api key mode: %', NEW.mode;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_merchant_api_key(
    p_wallet TEXT,
    p_publishable_key TEXT,
    p_secret_key_hash TEXT,
    p_secret_key_hint TEXT,
    p_mode TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new public.api_keys%ROWTYPE;
    v_mode TEXT;
BEGIN
    IF p_wallet !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'invalid api key wallet';
    END IF;
    IF p_publishable_key !~ '^(pk_test_|pk_live_)[0-9a-f]{16,}$' THEN
        RAISE EXCEPTION 'invalid publishable key format';
    END IF;
    IF p_secret_key_hash !~ '^[0-9a-f]{64}$' OR p_secret_key_hint !~ '^(sk_test_|sk_live_)' THEN
        RAISE EXCEPTION 'invalid secret key material';
    END IF;

    -- Infer or validate mode from keys
    IF p_publishable_key LIKE 'pk_live_%' THEN
        IF p_secret_key_hint NOT LIKE 'sk_live_%' THEN
            RAISE EXCEPTION 'mismatched key modes: publishable is LIVE but secret hint is not';
        END IF;
        v_mode := 'LIVE';
    ELSE
        IF p_secret_key_hint NOT LIKE 'sk_test_%' THEN
            RAISE EXCEPTION 'mismatched key modes: publishable is TEST but secret hint is not';
        END IF;
        v_mode := 'TEST';
    END IF;

    IF p_mode IS NOT NULL AND p_mode <> v_mode THEN
        RAISE EXCEPTION 'explicit mode % does not match key prefix mode %', p_mode, v_mode;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_wallet || ':api-keys', 7401));

    INSERT INTO public.api_keys (
        wallet_address, publishable_key, secret_key_hash, secret_key_hint, mode, revoked
    ) VALUES (
        p_wallet, p_publishable_key, p_secret_key_hash, left(p_secret_key_hint, 32), v_mode, false
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

REVOKE EXECUTE ON FUNCTION public.rotate_merchant_api_key(TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_merchant_api_key(TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role, postgres;
