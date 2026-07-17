/*
 * Durable, budgeted gas sponsorship.
 *
 * The previous sponsor was a drainable faucet: a fixed 0.10 native-USDC transfer per
 * request, deduplicated only by a 30-second in-process cache — invisible to other
 * serverless instances, reset on redeploy, and blind to repeated abuse.
 *
 * Every sponsorship now claims a durable row keyed by a stable request key, shared by
 * every instance. A submitted transfer is reconciled by hash, never resubmitted.
 * Per-wallet, per-action and global daily budgets are enforced inside the claim so
 * concurrent instances cannot overshoot them.
 */

CREATE TABLE IF NOT EXISTS public.sponsored_gas_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key TEXT NOT NULL UNIQUE CHECK (char_length(request_key) BETWEEN 8 AND 256),
    wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
    action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
    custody_type TEXT NOT NULL CHECK (custody_type IN ('CIRCLE_SCA', 'CIRCLE_EOA', 'LEGACY_EOA')),
    requested_topup_wei NUMERIC(38, 0) NOT NULL DEFAULT 0 CHECK (requested_topup_wei >= 0),
    sponsor_tx_hash TEXT UNIQUE CHECK (sponsor_tx_hash IS NULL OR sponsor_tx_hash ~ '^0x[0-9a-f]{64}$'),
    financial_tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'SUBMITTED', 'CONFIRMED', 'SKIPPED_GAS_STATION', 'SKIPPED_SUFFICIENT_BALANCE', 'FAILED'
    )),
    failure_reason TEXT,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sponsored_gas_operations_wallet_day_idx
    ON public.sponsored_gas_operations (wallet_address, created_at);
CREATE INDEX IF NOT EXISTS sponsored_gas_operations_day_idx
    ON public.sponsored_gas_operations (created_at);

ALTER TABLE public.sponsored_gas_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sponsored_gas_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sponsored_gas_operations TO service_role, postgres;

/*
 * Atomically claim (or reuse) the sponsorship for one logical operation.
 *
 * Outcomes:
 *   REUSED           — a terminal record exists (CONFIRMED / SKIPPED_*); its hash is returned.
 *   RECONCILE        — a transfer was submitted earlier; reconcile by hash, never resubmit.
 *   IN_PROGRESS      — another instance holds a live lease.
 *   KEY_CONFLICT     — the request key exists for a different wallet/action.
 *   WALLET_LIMIT     — the wallet hit its daily sponsorship count.
 *   ACTION_LIMIT     — the wallet hit its daily count for this action.
 *   BUDGET_EXHAUSTED — the global daily sponsored amount would exceed the budget.
 *   GAS_STATION      — Circle SCA custody: recorded, no transfer, no budget consumed.
 *   CLAIMED          — the caller holds the lease and may submit one bounded transfer.
 */
CREATE OR REPLACE FUNCTION public.claim_sponsored_gas_operation(
    p_request_key TEXT,
    p_wallet TEXT,
    p_action TEXT,
    p_custody TEXT,
    p_requested_wei NUMERIC,
    p_wallet_daily_limit INTEGER,
    p_action_daily_limit INTEGER,
    p_global_daily_budget_wei NUMERIC,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing public.sponsored_gas_operations%ROWTYPE;
    v_lease UUID;
    v_wallet_count INTEGER;
    v_action_count INTEGER;
    v_spent NUMERIC;
BEGIN
    IF p_wallet !~ '^0x[0-9a-f]{40}$' OR char_length(COALESCE(p_request_key, '')) < 8 THEN
        RAISE EXCEPTION 'invalid sponsorship claim parameters';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_wallet) || ':gas-sponsor', 7301));

    SELECT * INTO v_existing
    FROM public.sponsored_gas_operations
    WHERE request_key = p_request_key
    FOR UPDATE;
    IF FOUND THEN
        IF lower(v_existing.wallet_address) IS DISTINCT FROM lower(p_wallet)
           OR v_existing.action IS DISTINCT FROM p_action THEN
            RETURN jsonb_build_object('outcome', 'KEY_CONFLICT');
        END IF;
        IF v_existing.status IN ('CONFIRMED', 'SKIPPED_GAS_STATION', 'SKIPPED_SUFFICIENT_BALANCE') THEN
            RETURN jsonb_build_object('outcome', 'REUSED', 'status', v_existing.status,
                'sponsorTxHash', v_existing.sponsor_tx_hash);
        END IF;
        IF v_existing.status = 'SUBMITTED' THEN
            RETURN jsonb_build_object('outcome', 'RECONCILE',
                'sponsorTxHash', v_existing.sponsor_tx_hash);
        END IF;
        IF v_existing.status = 'PENDING' AND v_existing.lease_expires_at > now() THEN
            RETURN jsonb_build_object('outcome', 'IN_PROGRESS');
        END IF;
        /* PENDING with an expired lease, or a pre-broadcast FAILED row: re-claim it. */
        v_lease := extensions.gen_random_uuid();
        UPDATE public.sponsored_gas_operations
        SET status = 'PENDING', lease_token = v_lease,
            lease_expires_at = now() + make_interval(secs => greatest(30, least(COALESCE(p_lease_seconds, 120), 300))),
            requested_topup_wei = COALESCE(p_requested_wei, requested_topup_wei),
            failure_reason = NULL, updated_at = now()
        WHERE request_key = p_request_key;
        RETURN jsonb_build_object('outcome', 'CLAIMED', 'leaseToken', v_lease);
    END IF;

    IF p_custody = 'CIRCLE_SCA' THEN
        INSERT INTO public.sponsored_gas_operations (
            request_key, wallet_address, action, custody_type, requested_topup_wei, status
        ) VALUES (p_request_key, lower(p_wallet), p_action, p_custody, 0, 'SKIPPED_GAS_STATION')
        ON CONFLICT (request_key) DO NOTHING;
        RETURN jsonb_build_object('outcome', 'GAS_STATION');
    END IF;

    /* Daily abuse limits count every record that held or may hold funds. */
    SELECT count(*) INTO v_wallet_count
    FROM public.sponsored_gas_operations
    WHERE lower(wallet_address) = lower(p_wallet)
      AND status IN ('PENDING', 'SUBMITTED', 'CONFIRMED')
      AND created_at >= now() - interval '1 day';
    IF v_wallet_count >= COALESCE(p_wallet_daily_limit, 10) THEN
        RETURN jsonb_build_object('outcome', 'WALLET_LIMIT');
    END IF;

    SELECT count(*) INTO v_action_count
    FROM public.sponsored_gas_operations
    WHERE lower(wallet_address) = lower(p_wallet)
      AND action = p_action
      AND status IN ('PENDING', 'SUBMITTED', 'CONFIRMED')
      AND created_at >= now() - interval '1 day';
    IF v_action_count >= COALESCE(p_action_daily_limit, 5) THEN
        RETURN jsonb_build_object('outcome', 'ACTION_LIMIT');
    END IF;

    SELECT COALESCE(sum(requested_topup_wei), 0) INTO v_spent
    FROM public.sponsored_gas_operations
    WHERE status IN ('PENDING', 'SUBMITTED', 'CONFIRMED')
      AND created_at >= now() - interval '1 day';
    IF v_spent + COALESCE(p_requested_wei, 0) > COALESCE(p_global_daily_budget_wei, 0) THEN
        RETURN jsonb_build_object('outcome', 'BUDGET_EXHAUSTED');
    END IF;

    v_lease := extensions.gen_random_uuid();
    INSERT INTO public.sponsored_gas_operations (
        request_key, wallet_address, action, custody_type, requested_topup_wei,
        status, lease_token, lease_expires_at
    ) VALUES (
        p_request_key, lower(p_wallet), p_action, p_custody, COALESCE(p_requested_wei, 0),
        'PENDING', v_lease,
        now() + make_interval(secs => greatest(30, least(COALESCE(p_lease_seconds, 120), 300)))
    );
    RETURN jsonb_build_object('outcome', 'CLAIMED', 'leaseToken', v_lease);
END;
$$;

/*
 * Record the result of a claimed sponsorship. A row that ever carried a transaction hash can
 * never be marked FAILED — an ambiguous transfer stays SUBMITTED until reconciled by hash.
 */
CREATE OR REPLACE FUNCTION public.update_sponsored_gas_operation(
    p_request_key TEXT,
    p_lease_token UUID,
    p_status TEXT,
    p_sponsor_tx_hash TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_financial_tx_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.sponsored_gas_operations%ROWTYPE;
BEGIN
    IF p_status NOT IN ('SUBMITTED', 'CONFIRMED', 'SKIPPED_SUFFICIENT_BALANCE', 'FAILED') THEN
        RAISE EXCEPTION 'invalid sponsorship status transition';
    END IF;

    SELECT * INTO v_row
    FROM public.sponsored_gas_operations
    WHERE request_key = p_request_key
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'MISSING'); END IF;
    IF v_row.lease_token IS DISTINCT FROM p_lease_token THEN
        RETURN jsonb_build_object('outcome', 'LEASE_MISMATCH');
    END IF;
    IF v_row.status IN ('CONFIRMED', 'SKIPPED_GAS_STATION', 'SKIPPED_SUFFICIENT_BALANCE') THEN
        RETURN jsonb_build_object('outcome', 'ALREADY_TERMINAL');
    END IF;
    IF v_row.sponsor_tx_hash IS NOT NULL
       AND p_sponsor_tx_hash IS NOT NULL
       AND lower(v_row.sponsor_tx_hash) IS DISTINCT FROM lower(p_sponsor_tx_hash) THEN
        RETURN jsonb_build_object('outcome', 'HASH_CONFLICT');
    END IF;
    IF p_status = 'FAILED' AND (v_row.sponsor_tx_hash IS NOT NULL OR p_sponsor_tx_hash IS NOT NULL) THEN
        /* A broadcast transfer is never failed — it must reconcile by hash. */
        RETURN jsonb_build_object('outcome', 'HASH_BOUND');
    END IF;

    UPDATE public.sponsored_gas_operations
    SET status = p_status,
        sponsor_tx_hash = COALESCE(lower(p_sponsor_tx_hash), sponsor_tx_hash),
        financial_tx_hash = COALESCE(p_financial_tx_hash, financial_tx_hash),
        failure_reason = left(p_failure_reason, 500),
        lease_token = CASE WHEN p_status IN ('CONFIRMED', 'FAILED', 'SKIPPED_SUFFICIENT_BALANCE') THEN NULL ELSE lease_token END,
        lease_expires_at = CASE WHEN p_status IN ('CONFIRMED', 'FAILED', 'SKIPPED_SUFFICIENT_BALANCE') THEN NULL ELSE lease_expires_at END,
        updated_at = now()
    WHERE request_key = p_request_key;
    RETURN jsonb_build_object('outcome', 'UPDATED');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_sponsored_gas_operation(TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER, INTEGER, NUMERIC, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sponsored_gas_operation(TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER, INTEGER, NUMERIC, INTEGER)
    TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.update_sponsored_gas_operation(TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_sponsored_gas_operation(TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
    TO service_role, postgres;
