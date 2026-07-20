-- Phase 5 & 6: Constrain & Clean-up

-- 1. Clean up existing null next_billing_date and last_settlement_timestamp for subscriptions before constraint
UPDATE public.subscriptions
    SET next_billing_date = '1970-01-01 00:00:00+00'::timestamptz
    WHERE next_billing_date IS NULL;

UPDATE public.subscriptions
    SET last_settlement_timestamp = '1970-01-01 00:00:00+00'::timestamptz
    WHERE last_settlement_timestamp IS NULL;

-- 2. Apply NOT NULL constraints to subscription billing dates
ALTER TABLE public.subscriptions
    ALTER COLUMN next_billing_date SET NOT NULL,
    ALTER COLUMN last_settlement_timestamp SET NOT NULL;

-- 3. Apply NOT NULL constraints to new webhook encryption columns
ALTER TABLE public.webhook_endpoints
    ALTER COLUMN ciphertext SET NOT NULL,
    ALTER COLUMN nonce SET NOT NULL,
    ALTER COLUMN authentication_tag SET NOT NULL,
    ALTER COLUMN key_version SET NOT NULL,
    ALTER COLUMN encryption_algorithm SET NOT NULL;

-- 4. Drop the legacy plaintext secret column
ALTER TABLE public.webhook_endpoints
    DROP COLUMN IF EXISTS secret;
