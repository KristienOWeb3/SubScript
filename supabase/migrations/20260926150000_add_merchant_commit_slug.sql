/*
 * Public merchant locator for Vault Commit pages.
 *
 * commit_slug is intentionally separate from:
 *   - merchant_id: internal/admin identity that merchants do not share with customers;
 *   - display_name: presentation copy that an admin may correct;
 *   - cmt_* Commit IDs: user/delegate bearer credentials that must not become public routes.
 *
 * The first merchant with a display name receives the clean slug ("Acme Cloud" ->
 * "acme-cloud"). A collision or reserved name receives an independent random suffix. Once
 * assigned, a database trigger makes the slug immutable for every caller, including admins.
 */

ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS commit_slug TEXT;

ALTER TABLE public.merchants
    ALTER COLUMN commit_slug SET DEFAULT (
        'merchant-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    );

DO $$
DECLARE
    merchant_row RECORD;
    base_slug TEXT;
    candidate TEXT;
BEGIN
    FOR merchant_row IN
        SELECT wallet_address, display_name
          FROM public.merchants
         WHERE commit_slug IS NULL OR btrim(commit_slug) = ''
         ORDER BY created_at, wallet_address
    LOOP
        base_slug := trim(BOTH '-' FROM regexp_replace(
            lower(COALESCE(NULLIF(btrim(merchant_row.display_name), ''), 'merchant')),
            '[^a-z0-9]+', '-', 'g'
        ));

        IF length(base_slug) < 3 THEN
            base_slug := 'merchant';
        END IF;
        base_slug := left(base_slug, 30);
        base_slug := trim(TRAILING '-' FROM base_slug);
        candidate := base_slug;

        IF candidate IN ('admin', 'api', 'commit', 'merchant', 'pay', 'settings', 'signin', 'signup', 'subscribe', 'subscript', 'support')
           OR EXISTS (SELECT 1 FROM public.merchants WHERE commit_slug = candidate) THEN
            LOOP
                candidate := left(base_slug, 23) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE commit_slug = candidate);
            END LOOP;
        END IF;

        UPDATE public.merchants
           SET commit_slug = candidate
         WHERE wallet_address = merchant_row.wallet_address;
    END LOOP;
END
$$;

ALTER TABLE public.merchants
    ALTER COLUMN commit_slug SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'merchants_commit_slug_key'
           AND conrelid = 'public.merchants'::regclass
    ) THEN
        ALTER TABLE public.merchants
            ADD CONSTRAINT merchants_commit_slug_key UNIQUE (commit_slug);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'merchants_commit_slug_format_chk'
           AND conrelid = 'public.merchants'::regclass
    ) THEN
        ALTER TABLE public.merchants
            ADD CONSTRAINT merchants_commit_slug_format_chk
            CHECK (commit_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.assign_merchant_commit_slug()
RETURNS TRIGGER AS $$
DECLARE
    base_slug TEXT;
    candidate TEXT;
BEGIN
    base_slug := trim(BOTH '-' FROM regexp_replace(
        lower(COALESCE(NULLIF(btrim(NEW.display_name), ''), 'merchant')),
        '[^a-z0-9]+', '-', 'g'
    ));

    IF length(base_slug) < 3 THEN
        base_slug := 'merchant';
    END IF;
    base_slug := trim(TRAILING '-' FROM left(base_slug, 30));
    candidate := base_slug;

    IF candidate IN ('admin', 'api', 'commit', 'merchant', 'pay', 'settings', 'signin', 'signup', 'subscribe', 'subscript', 'support')
       OR EXISTS (SELECT 1 FROM public.merchants WHERE commit_slug = candidate) THEN
        LOOP
            candidate := left(base_slug, 23) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE commit_slug = candidate);
        END LOOP;
    END IF;

    NEW.commit_slug := candidate;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchants_assign_commit_slug ON public.merchants;
CREATE TRIGGER merchants_assign_commit_slug
    BEFORE INSERT ON public.merchants
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_merchant_commit_slug();

CREATE OR REPLACE FUNCTION public.enforce_merchant_commit_slug_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.commit_slug IS DISTINCT FROM OLD.commit_slug THEN
        RAISE EXCEPTION 'commit_slug is immutable (attempted % -> %)', OLD.commit_slug, NEW.commit_slug;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchants_commit_slug_immutable ON public.merchants;
CREATE TRIGGER merchants_commit_slug_immutable
    BEFORE UPDATE ON public.merchants
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_merchant_commit_slug_immutable();
