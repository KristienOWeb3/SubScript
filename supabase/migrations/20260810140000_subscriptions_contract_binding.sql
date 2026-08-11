-- Bind every subscription row to the PSA contract that minted it, and repair the
-- orphaned rows left behind by the last contract redeploy.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `subscriptions.subscription_id` was the primary key on its own. That ID is minted
-- by SubScriptPSA and restarts at 1 on every redeploy, because the PSA is immutable
-- (no proxy — the EIP-1967 implementation slot is empty). So the ID is only meaningful
-- *relative to a contract address*, and the table never recorded which one.
--
-- Two consequences, one of them live in production on 2026-08-10:
--
--  1. COLLISION. The next PSA redeploy mints id 1, 2, 3… which collide with existing
--     rows. Insert fails or, worse, an upsert silently rewrites another customer's
--     subscription.
--
--  2. FALSE CANCELLATIONS (live bug). The deployed PSA
--     (0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2) reports nextSubscriptionId = 1 —
--     it has never minted a subscription. But this table holds 11 rows with ids 1..24
--     from earlier, now-abandoned deployments. When a keeper reads
--     `subscriptions(8)` on the current contract it gets a zeroed struct, sees
--     isActive = false, and takes the "cancelled directly on-chain" branch in
--     src/app/api/cron/customer-billing/route.ts (~line 275): it marks the row
--     CANCELED and dispatches `subscription.canceled` to the merchant with
--     reason "Canceled on-chain", carrying subscriber 0x000…000 and amount 0
--     (both read from the zeroed struct). The customer never cancelled.
--     Subscription id 8 (CUSTOMER, ACTIVE) was due to trigger exactly this on
--     2026-08-14. What prevented it firing sooner is that cron/reconcile — which
--     runs the drift healer — is not registered in vercel.json, so the healer has
--     not been running at all.
--
-- With contract_address in place, every chain-reading path filters on the configured
-- contract, orphans become invisible to the keepers, and neither failure can recur.
--
-- ORPHAN HANDLING
-- ---------------
-- The 11 pre-existing rows belong to contracts that are no longer configured, and the
-- lineage was never recorded, so it cannot be recovered from the data. They are bound
-- to an explicit sentinel address rather than guessed at. Backfilling them to the
-- CURRENT contract would have been actively wrong: it is precisely the state that
-- produces the false-cancellation bug above.
--
-- The two rows still marked ACTIVE (id 4 PREMIUM, id 8 CUSTOMER) are closed out here.
-- Deliberately NO webhook is dispatched for them: their authorization was stranded by
-- an operational redeploy, not cancelled by the customer, and emitting
-- `subscription.canceled` would be the same lie this migration exists to stop.
--
-- DEFAULT ON contract_address
-- ---------------------------
-- The column carries a DEFAULT of the current contract rather than being default-less.
-- `activate_premium_merchant` (a PL/pgSQL function, last redefined in
-- 20260715001000_harden_premium_subscription_lifecycle.sql) INSERTs into this table
-- without naming the column, and would break under a NOT NULL with no default.
--
--   >>> REDEPLOY CHECKLIST: this DEFAULT must be updated in the same change that
--   >>> updates NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS, or new rows will be labelled
--   >>> with the old contract. See docs note added alongside this migration.
--
-- All statements are idempotent, matching the house style in
-- 20260810120000_admin_console_foundations.sql.

-- ---------------------------------------------------------------------------
-- 1. Add the column WITHOUT a default.
--
--    `ADD COLUMN ... DEFAULT x` backfills every existing row with x immediately, which
--    would stamp all pre-existing rows with the CURRENT contract — precisely the broken
--    state this migration exists to repair, and it would silently no-op steps 2-4.
--    So: add bare, backfill deliberately, then attach the default in step 5 for future
--    inserts only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS contract_address text;

COMMENT ON COLUMN public.subscriptions.contract_address IS
    'Lowercased address of the PSA contract that minted subscription_id. Part of the '
    'primary key: PSA ids restart at 1 on every redeploy, so the id alone is ambiguous. '
    'Chain-reading code MUST filter on this. Sentinel 0x…dead marks rows whose contract '
    'is no longer known (stranded by a redeploy before this column existed).';

-- ---------------------------------------------------------------------------
-- 2. Bind pre-existing rows to the sentinel. Every row present before this migration
--    predates the column, so every one of them is of unknown lineage.
-- ---------------------------------------------------------------------------
UPDATE public.subscriptions
   SET contract_address = '0x000000000000000000000000000000000000dead'
 WHERE contract_address IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Close out orphaned rows that are still live. No webhook — see header.
-- ---------------------------------------------------------------------------
UPDATE public.subscriptions
   SET status              = 'CANCELED',
       cancel_at_period_end = false,
       revocation_pending   = false,
       cancel_requested_at  = COALESCE(cancel_requested_at, now()),
       updated_at           = now()
 WHERE contract_address = '0x000000000000000000000000000000000000dead'
   AND status IN ('ACTIVE', 'PAST_DUE');

-- ---------------------------------------------------------------------------
-- 4. Repair corrupt PREMIUM amounts on the orphaned rows.
--    amount_cap_usdc is canonical integer micro-USDC (see the comment in
--    src/lib/payments/activateSubscription.ts). Premium is 10 USDC/mo = 10000000
--    micros, but two rows store a literal 10, i.e. $0.00001. An older writer stored
--    whole USDC in a micro-USDC column. Scoped to the sentinel rows and to the exact
--    corrupt value so it cannot touch a legitimately small plan.
--    src/app/api/merchant/subscriptions/route.ts:194 divides this column to compute
--    monthly revenue, so leaving it understates that merchant's MRR by 10^6.
-- ---------------------------------------------------------------------------
UPDATE public.subscriptions
   SET amount_cap_usdc = 10000000,
       updated_at      = now()
 WHERE contract_address = '0x000000000000000000000000000000000000dead'
   AND kind = 'PREMIUM'
   AND amount_cap_usdc = 10;

-- ---------------------------------------------------------------------------
-- 5. Enforce the invariant: present, lowercase, 20-byte hex. The DEFAULT is attached
--    only now, so it applies to FUTURE inserts and never retroactively labels the
--    stranded rows. It exists because activate_premium_merchant (PL/pgSQL, see step 8)
--    INSERTs without naming the column.
--
--   >>> REDEPLOY CHECKLIST: this DEFAULT must be updated in the same change that
--   >>> updates NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS, or new rows will be labelled
--   >>> with the old contract.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
    ALTER COLUMN contract_address SET DEFAULT '0x59df2224e7f9dced25f3aaee9fff939f92f5f4d2';

ALTER TABLE public.subscriptions
    ALTER COLUMN contract_address SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.subscriptions'::regclass
           AND conname  = 'subscriptions_contract_address_lowercase_hex'
    ) THEN
        ALTER TABLE public.subscriptions
            ADD CONSTRAINT subscriptions_contract_address_lowercase_hex
            CHECK (contract_address ~ '^0x[0-9a-f]{40}$');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Swap the primary key to (contract_address, subscription_id).
--    No foreign keys reference this table, so the swap needs no cascade handling
--    (verified against the live schema: pg_constraint has no rows with
--    confrelid = 'subscriptions'::regclass).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    pk_name text;
    pk_cols text;
BEGIN
    SELECT c.conname,
           string_agg(a.attname, ',' ORDER BY a.attnum)
      INTO pk_name, pk_cols
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.subscriptions'::regclass
       AND c.contype  = 'p'
     GROUP BY c.conname;

    /* Already migrated — nothing to do. */
    IF pk_cols IS NOT NULL AND pk_cols LIKE '%contract_address%' THEN
        RETURN;
    END IF;

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT %I', pk_name);
    END IF;

    ALTER TABLE public.subscriptions
        ADD CONSTRAINT subscriptions_pkey
        PRIMARY KEY (contract_address, subscription_id);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Keepers and the drift healer scan "live rows on the configured contract".
--    Without this they fall back to a scan that widens as the sentinel rows and
--    future contract generations accumulate.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS subscriptions_contract_kind_status_due_idx
    ON public.subscriptions (contract_address, kind, status, next_billing_date);

-- ---------------------------------------------------------------------------
-- 8. Repoint activate_premium_merchant at the new key.
--
--    Its `ON CONFLICT (subscription_id)` inference clause names the OLD primary
--    key. Once step 6 drops that constraint the function raises
--    "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification" on every premium activation — so the function must be
--    replaced in the same migration, not a later one.
--
--    contract_address is intentionally omitted from the INSERT column list: the
--    column DEFAULT from step 1 supplies it, and ON CONFLICT infers against the
--    row as it will be stored (defaults included), so the composite inference
--    resolves correctly. This keeps the function signature unchanged, so the
--    existing caller in src/lib/payments/activateSubscription.ts needs no edit.
--
--    Body is otherwise byte-identical to
--    20260715001000_harden_premium_subscription_lifecycle.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_premium_merchant(
    p_merchant_address TEXT,
    p_subscription_id BIGINT,
    p_session_id UUID,
    p_tx_hash TEXT,
    p_amount NUMERIC,
    p_period BIGINT,
    p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    normalized_merchant TEXT := lower(p_merchant_address);
BEGIN
    IF normalized_merchant !~ '^0x[0-9a-f]{40}$'
       OR p_subscription_id <= 0
       OR p_amount <= 0
       OR p_period <= 0 THEN
        RAISE EXCEPTION 'invalid premium activation parameters';
    END IF;

    PERFORM 1
    FROM public.payment_sessions AS session
    WHERE session.session_id = p_session_id
      AND session.status = 'PROCESSING'
      AND session.processing_claim_id = p_claim_id
      AND lower(session.tx_hash) = lower(p_tx_hash)
      AND lower(session.merchant_address) = normalized_merchant
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'premium payment session claim is no longer owned' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.merchants (wallet_address, tier, updated_at)
    VALUES (normalized_merchant, 'PREMIUM', now())
    ON CONFLICT (wallet_address)
    DO UPDATE SET tier = 'PREMIUM', updated_at = now();

    INSERT INTO public.subscriptions (
        subscription_id, merchant_address, subscriber, current_nonce,
        last_settlement_timestamp, billing_interval_seconds, amount_cap_usdc,
        payment_tx_hash, status, kind, tier, updated_at
    ) VALUES (
        p_subscription_id, normalized_merchant, normalized_merchant, 0,
        now(), p_period, p_amount, lower(p_tx_hash), 'ACTIVE', 'PREMIUM', 1, now()
    )
    ON CONFLICT (contract_address, subscription_id) DO UPDATE SET
        merchant_address = normalized_merchant,
        subscriber = normalized_merchant,
        last_settlement_timestamp = now(),
        billing_interval_seconds = p_period,
        amount_cap_usdc = p_amount,
        payment_tx_hash = lower(p_tx_hash),
        status = 'ACTIVE',
        kind = 'PREMIUM',
        tier = 1,
        updated_at = now();

    UPDATE public.payment_sessions
    SET status = 'COMPLETED', processing_claim_id = NULL, processing_started_at = NULL,
        last_error = NULL, failure_code = NULL, updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'PROCESSING'
      AND processing_claim_id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'premium payment session ownership changed during activation';
    END IF;
END;
$$;
