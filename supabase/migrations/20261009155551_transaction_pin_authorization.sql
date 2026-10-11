ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS binding_digest text;
ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS session_digest text;

CREATE TABLE IF NOT EXISTS public.financial_step_up_consumptions (
    jti uuid PRIMARY KEY,
    wallet_address text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.transaction_pin_credentials (
    wallet_address text PRIMARY KEY CHECK (wallet_address = lower(wallet_address)),
    salt text NOT NULL,
    pin_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    cooling_off_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.transaction_pin_operations (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address text NOT NULL,
    operation_id text NOT NULL,
    session_digest text NOT NULL,
    binding_digest text NOT NULL,
    request_digest text NOT NULL,
    credential_version integer,
    state text NOT NULL DEFAULT 'challenge' CHECK (state IN ('challenge','authorized','running','complete','unknown')),
    token_hash text,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    response_status integer,
    response_body text,
    response_content_type text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(wallet_address, operation_id)
);
CREATE INDEX IF NOT EXISTS transaction_pin_operations_expiry_idx ON public.transaction_pin_operations(expires_at);
CREATE TABLE IF NOT EXISTS public.transaction_pin_security_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address text NOT NULL,
    event_kind text NOT NULL CHECK (event_kind IN ('enroll','change','reset')),
    cooling_off_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    enqueued_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['financial_step_up_consumptions','transaction_pin_credentials','transaction_pin_operations','transaction_pin_security_events'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('DROP POLICY IF EXISTS deny_public ON public.%I', t);
        EXECUTE format('CREATE POLICY deny_public ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    END LOOP;
END $$;


