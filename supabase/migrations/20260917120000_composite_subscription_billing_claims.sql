/*
 * Composite Contract Scoping for Subscription Billing Claims
 *
 * Resolves cross-contract generation contention when SubScript PSA contracts
 * are redeployed. In immutable contracts, nextSubscriptionId restarts at 1,
 * so (subscription_id, sequence_id) is NOT globally unique across contract deployments.
 *
 * This migration:
 * 1. Ensures contract_address exists on public.subscription_billing_claims (lowercased).
 * 2. Replaces PK / unique constraint with composite PK (contract_address, subscription_id, sequence_id).
 * 3. Updates claim_subscription_billing, record_subscription_billing_chain_confirmation,
 *    renew_subscription_billing, complete_subscription_billing, and release_subscription_billing
 *    to require and scope by p_contract_address.
 */

DO $$
BEGIN
    -- Add the column as nullable first. Existing claims predate contract scoping and must be
    -- backfilled from the canonical subscriptions mirror before NOT NULL can be enforced.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
          AND table_name = 'subscription_billing_claims' 
          AND column_name = 'contract_address'
    ) THEN
        ALTER TABLE public.subscription_billing_claims ADD COLUMN contract_address TEXT;
    END IF;

    ALTER TABLE public.subscription_billing_claims
        ALTER COLUMN contract_address DROP DEFAULT;

    -- Normalize rows already populated by an operator/cutover script.
    UPDATE public.subscription_billing_claims
    SET contract_address = lower(trim(contract_address))
    WHERE contract_address IS NOT NULL;

    /* A legacy claim can be backfilled only when its numeric subscription id maps to exactly one
       contract generation. Guessing when multiple generations share the same id would recreate
       the very cross-contract collision this migration fixes. */
    UPDATE public.subscription_billing_claims AS claim
       SET contract_address = binding.contract_address
      FROM (
          SELECT subscription_id, min(contract_address) AS contract_address
            FROM public.subscriptions
           GROUP BY subscription_id
          HAVING count(DISTINCT contract_address) = 1
      ) AS binding
     WHERE claim.subscription_id = binding.subscription_id
       AND (claim.contract_address IS NULL OR trim(claim.contract_address) = '');

    IF EXISTS (
        SELECT 1
          FROM public.subscription_billing_claims
         WHERE contract_address IS NULL
            OR contract_address !~ '^0x[0-9a-f]{40}$'
    ) THEN
        RAISE EXCEPTION
            'Cannot safely scope legacy subscription billing claims: backfill contract_address before retrying';
    END IF;

    ALTER TABLE public.subscription_billing_claims
        ALTER COLUMN contract_address SET NOT NULL;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.subscription_billing_claims'::regclass
           AND conname = 'subscription_billing_claims_contract_address_check'
    ) THEN
        ALTER TABLE public.subscription_billing_claims
            ADD CONSTRAINT subscription_billing_claims_contract_address_check
            CHECK (contract_address ~ '^0x[0-9a-f]{40}$');
    END IF;

    -- Drop legacy primary key if constrained only on (subscription_id, sequence_id)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'subscription_billing_claims'
          AND constraint_name = 'subscription_billing_claims_pkey'
    ) THEN
        ALTER TABLE public.subscription_billing_claims DROP CONSTRAINT subscription_billing_claims_pkey;
    END IF;

    -- Drop legacy unique constraints if present
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_schema = 'public'
          AND table_name = 'subscription_billing_claims'
          AND constraint_name = 'subscription_billing_claims_subscription_id_key'
    ) THEN
        ALTER TABLE public.subscription_billing_claims DROP CONSTRAINT subscription_billing_claims_subscription_id_key;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_schema = 'public'
          AND table_name = 'subscription_billing_claims'
          AND constraint_name = 'subscription_billing_claims_subscription_id_sequence_id_key'
    ) THEN
        ALTER TABLE public.subscription_billing_claims DROP CONSTRAINT subscription_billing_claims_subscription_id_sequence_id_key;
    END IF;
END $$;

-- Enforce composite primary key
ALTER TABLE public.subscription_billing_claims
    ADD CONSTRAINT subscription_billing_claims_pkey PRIMARY KEY (contract_address, subscription_id, sequence_id);

-- The mainnet cutover draft created this expression index. The lowercase constraint above makes
-- it redundant with the composite primary key, so remove it to avoid duplicate write overhead.
DROP INDEX IF EXISTS public.subscription_billing_claims_contract_sub_seq_idx;

CREATE INDEX IF NOT EXISTS subscription_billing_claims_status_lease_idx
    ON public.subscription_billing_claims (status, lease_until);

CREATE INDEX IF NOT EXISTS spending_limit_operations_wallet_window_idx
    ON public.spending_limit_operations (lower(user_address), created_at DESC)
    WHERE status IN ('PENDING', 'FINALIZED');

-- Drop legacy procedures missing p_contract_address
DROP FUNCTION IF EXISTS public.claim_subscription_billing(BIGINT, BIGINT, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.record_subscription_billing_chain_confirmation(BIGINT, BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.renew_subscription_billing(BIGINT, BIGINT, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.complete_subscription_billing(BIGINT, BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.release_subscription_billing(BIGINT, BIGINT, UUID);

-- 1. claim_subscription_billing (scoped by contract_address)
CREATE OR REPLACE FUNCTION public.claim_subscription_billing(
    p_contract_address TEXT,
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_lease_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_contract TEXT := lower(trim(p_contract_address));
    claimed BOOLEAN := false;
BEGIN
    IF v_contract !~ '^0x[0-9a-f]{40}$'
       OR p_subscription_id <= 0 OR p_sequence_id <= 0 OR p_claim_id IS NULL
       OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing claim parameters';
    END IF;

    INSERT INTO public.subscription_billing_claims (
        contract_address, subscription_id, sequence_id, claim_id, status, lease_until
    ) VALUES (
        v_contract, p_subscription_id, p_sequence_id, p_claim_id, 'PROCESSING', now() + make_interval(secs => p_lease_seconds)
    )
    ON CONFLICT (contract_address, subscription_id, sequence_id) DO UPDATE
    SET claim_id = EXCLUDED.claim_id,
        status = CASE
            WHEN public.subscription_billing_claims.status = 'CHAIN_CONFIRMED' THEN 'CHAIN_CONFIRMED'
            ELSE 'PROCESSING'
        END,
        lease_until = EXCLUDED.lease_until,
        updated_at = now()
    WHERE public.subscription_billing_claims.status <> 'COMPLETED'
      AND public.subscription_billing_claims.lease_until < now()
    RETURNING true INTO claimed;

    RETURN COALESCE(claimed, false);
END;
$$;

-- 2. record_subscription_billing_chain_confirmation (scoped by contract_address)
CREATE OR REPLACE FUNCTION public.record_subscription_billing_chain_confirmation(
    p_contract_address TEXT,
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_tx_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH recorded AS (
        UPDATE public.subscription_billing_claims
        SET status = 'CHAIN_CONFIRMED', tx_hash = lower(p_tx_hash), updated_at = now()
        WHERE contract_address = lower(trim(p_contract_address))
          AND subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
          AND p_tx_hash ~ '^0x[0-9A-Fa-f]{64}$'
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM recorded);
$$;

-- 3. renew_subscription_billing (scoped by contract_address)
CREATE OR REPLACE FUNCTION public.renew_subscription_billing(
    p_contract_address TEXT,
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_lease_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_contract TEXT := lower(trim(p_contract_address));
    renewed BOOLEAN := false;
BEGIN
    IF v_contract !~ '^0x[0-9a-f]{40}$'
       OR p_claim_id IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid billing lease parameters';
    END IF;

    UPDATE public.subscription_billing_claims
    SET lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    WHERE contract_address = v_contract
      AND subscription_id = p_subscription_id
      AND sequence_id = p_sequence_id
      AND claim_id = p_claim_id
      AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
      AND lease_until >= now()
    RETURNING true INTO renewed;

    RETURN COALESCE(renewed, false);
END;
$$;

-- 4. complete_subscription_billing (scoped by contract_address)
CREATE OR REPLACE FUNCTION public.complete_subscription_billing(
    p_contract_address TEXT,
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID,
    p_tx_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH completed AS (
        UPDATE public.subscription_billing_claims
        SET status = 'COMPLETED',
            tx_hash = COALESCE(lower(p_tx_hash), tx_hash),
            lease_until = now(), updated_at = now()
        WHERE contract_address = lower(trim(p_contract_address))
          AND subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status IN ('PROCESSING', 'CHAIN_CONFIRMED')
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM completed);
$$;

-- 5. release_subscription_billing (scoped by contract_address)
CREATE OR REPLACE FUNCTION public.release_subscription_billing(
    p_contract_address TEXT,
    p_subscription_id BIGINT,
    p_sequence_id BIGINT,
    p_claim_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH released AS (
        DELETE FROM public.subscription_billing_claims
        WHERE contract_address = lower(trim(p_contract_address))
          AND subscription_id = p_subscription_id
          AND sequence_id = p_sequence_id
          AND claim_id = p_claim_id
          AND status = 'PROCESSING'
          AND tx_hash IS NULL
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM released);
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.claim_subscription_billing(TEXT, BIGINT, BIGINT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_billing(TEXT, BIGINT, BIGINT, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_subscription_billing_chain_confirmation(TEXT, BIGINT, BIGINT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_billing_chain_confirmation(TEXT, BIGINT, BIGINT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.renew_subscription_billing(TEXT, BIGINT, BIGINT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_subscription_billing(TEXT, BIGINT, BIGINT, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.complete_subscription_billing(TEXT, BIGINT, BIGINT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_billing(TEXT, BIGINT, BIGINT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.release_subscription_billing(TEXT, BIGINT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_subscription_billing(TEXT, BIGINT, BIGINT, UUID) TO service_role;
