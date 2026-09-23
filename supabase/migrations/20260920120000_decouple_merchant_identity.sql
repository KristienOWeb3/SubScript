/*
 * Decouple merchant identity from .sub / .hq / .biz DNS handles.
 *
 * Until now a merchant's public name was derived at read time by stripping the DNS suffix off
 * their address_aliases handle (merchantDisplayName(alias)). That leaked the handle on every
 * public checkout — anyone could reverse it to the wallet and inspect balances/history — and
 * forced businesses and individuals to share one .sub namespace.
 *
 * This migration adds two purpose-built identity fields to merchants:
 *   - merchant_id       : immutable, globally-unique public id (merc_<hex>). Never editable by
 *                         anyone (a BEFORE UPDATE trigger enforces this). NOT routable for P2P.
 *   - display_name      : admin-governed business name shown on checkout, receipts, and user
 *                         dashboards, with display_name_locked gating self-serve edits.
 * and carries an admin-defined display_name on merchant_access_grants so an invite can pre-seed
 * (and lock) the name at claim time.
 *
 * DB-level DEFAULTs are mandatory here, not just convenience: merchant rows are minted/upserted
 * from several call sites besides register-role (src/lib/subscriptions/mirror.ts,
 * src/lib/v1/merchantAuth.ts, src/app/api/user/settings/route.ts,
 * src/app/api/user/vault/commit/route.ts, src/app/api/merchant/alias/route.ts). Every such insert
 * must receive a valid merchant_id + display_name without touching those call sites.
 *
 * Idempotent and safe to re-run. Applied by scripts/apply-migrations.mjs (one transaction).
 */

-- 1. New identity columns (nullable first so the backfill can populate them).
ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS merchant_id TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS display_name_locked BOOLEAN;

-- Column defaults (safe to set repeatedly). merc_<12 lowercase hex>, matching the app-side
-- generator in src/lib/merchants/identity.ts and the CHECK below.
ALTER TABLE public.merchants
    ALTER COLUMN merchant_id SET DEFAULT ('merc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    ALTER COLUMN display_name SET DEFAULT '',
    ALTER COLUMN display_name_locked SET DEFAULT true;

-- 2a. Backfill merchant_id for any row missing one (gen_random_uuid() is distinct per row).
UPDATE public.merchants
    SET merchant_id = 'merc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    WHERE merchant_id IS NULL;

-- 2b. Backfill display_name from the merchant's current alias (suffix-stripped, punctuation ->
--     spaces, title-cased) so existing checkouts keep the exact name customers already see. This is
--     a one-time COPY of the value, not a live dependency on address_aliases.
UPDATE public.merchants m
    SET display_name = trim(
        initcap(
            regexp_replace(
                translate(regexp_replace(a.alias, '\.(sub|hq|biz)$', '', 'i'), '-_.', '   '),
                '\s+', ' ', 'g'
            )
        )
    )
    FROM public.address_aliases a
    WHERE lower(a.address) = lower(m.wallet_address)
      AND (m.display_name IS NULL OR m.display_name = '')
      AND a.alias IS NOT NULL
      AND a.alias <> '';

-- 2c. Any remaining gaps -> safe defaults (locked; an admin can set a real name later).
UPDATE public.merchants SET display_name = '' WHERE display_name IS NULL;
UPDATE public.merchants SET display_name_locked = true WHERE display_name_locked IS NULL;

-- 3. Constraints: NOT NULL, uniqueness, and merc_ format.
ALTER TABLE public.merchants
    ALTER COLUMN merchant_id SET NOT NULL,
    ALTER COLUMN display_name SET NOT NULL,
    ALTER COLUMN display_name_locked SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchants_merchant_id_key') THEN
        ALTER TABLE public.merchants ADD CONSTRAINT merchants_merchant_id_key UNIQUE (merchant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchants_merchant_id_format_chk') THEN
        ALTER TABLE public.merchants
            ADD CONSTRAINT merchants_merchant_id_format_chk CHECK (merchant_id ~ '^merc_[a-z0-9]+$');
    END IF;
END $$;

-- 4. Immutability: merchant_id can never change once set. Enforced in the database so that neither
--    a merchant, nor an admin, nor a stray UPDATE can alter it. Regular updates that leave
--    merchant_id untouched (the DO UPDATE SET updated_at = now() upserts, verify toggles, settings
--    writes, display_name edits) pass through unaffected.
CREATE OR REPLACE FUNCTION public.enforce_merchant_id_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
        RAISE EXCEPTION 'merchant_id is immutable (attempted % -> %)', OLD.merchant_id, NEW.merchant_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchants_merchant_id_immutable ON public.merchants;
CREATE TRIGGER merchants_merchant_id_immutable
    BEFORE UPDATE ON public.merchants
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_merchant_id_immutable();

-- 5. Admin-defined display name carried on the invite grant, stamped onto the merchant at claim.
ALTER TABLE public.merchant_access_grants
    ADD COLUMN IF NOT EXISTS display_name TEXT;
