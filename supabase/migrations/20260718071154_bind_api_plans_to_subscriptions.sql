-- API-created catalog plans can be public or assigned to one subscriber. The source
-- checkout remains the canonical/idempotent product identity.
ALTER TABLE public.merchant_plans
    ADD COLUMN IF NOT EXISTS target_subscriber TEXT;

CREATE INDEX IF NOT EXISTS merchant_plans_visibility_idx
    ON public.merchant_plans (merchant_address, active, target_subscriber);

-- Preserve the merchant's own account identifier and the checkout that activated the
-- on-chain authorization. Both are nullable for legacy/manual subscriptions.
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS external_reference TEXT,
    ADD COLUMN IF NOT EXISTS source_checkout_id UUID;

CREATE INDEX IF NOT EXISTS subscriptions_merchant_reference_idx
    ON public.subscriptions (merchant_address, external_reference, kind, status);

CREATE INDEX IF NOT EXISTS subscriptions_source_checkout_id_idx
    ON public.subscriptions (source_checkout_id);

-- Backfill only when the existing mirror and checkout share the same confirmed transaction.
-- Do not guess from amount or recency: that could bind a subscription to the wrong merchant account.
UPDATE public.subscriptions AS subscription
SET
    external_reference = checkout.external_reference,
    source_checkout_id = checkout.id,
    updated_at = now()
FROM public.payment_links AS checkout
WHERE subscription.kind = 'CUSTOMER'
  AND subscription.payment_tx_hash IS NOT NULL
  AND checkout.verified_tx_hash IS NOT NULL
  AND lower(subscription.payment_tx_hash) = lower(checkout.verified_tx_hash)
  AND lower(subscription.merchant_address) = lower(checkout.merchant_address)
  AND (subscription.external_reference IS NULL OR subscription.source_checkout_id IS NULL);

-- Repair API subscription products created before automatic catalog publication shipped.
-- Generic checkouts become reusable public plans; subscriber-assigned checkouts remain
-- visible only to that wallet. Private beneficiary/invoice terms are deliberately excluded.
INSERT INTO public.merchant_plans (
    merchant_address,
    source_checkout_id,
    target_subscriber,
    name,
    description,
    amount_usdc,
    period_seconds,
    min_commitment_seconds,
    active,
    created_at,
    updated_at
)
SELECT
    pl.merchant_address,
    pl.id,
    NULLIF(lower(pl.state_snapshot -> 'subscription' ->> 'subscriber'), ''),
    left(COALESCE(NULLIF(btrim(pl.title), ''), 'Subscription'), 60),
    CASE
        WHEN pl.description IS NULL THEN NULL
        ELSE left(pl.description, 300)
    END,
    pl.amount_usdc,
    (pl.state_snapshot -> 'subscription' ->> 'intervalSeconds')::bigint
        * (pl.state_snapshot -> 'subscription' ->> 'intervalCount')::bigint,
    CASE
        WHEN COALESCE(pl.state_snapshot -> 'subscription' ->> 'minCommitmentSeconds', '') ~ '^[0-9]{1,15}$'
            THEN (pl.state_snapshot -> 'subscription' ->> 'minCommitmentSeconds')::bigint
        ELSE 0
    END,
    CASE
        WHEN NULLIF(pl.state_snapshot -> 'subscription' ->> 'subscriber', '') IS NOT NULL
            THEN pl.active AND pl.status = 'PENDING'
        ELSE pl.active AND pl.status IN ('PENDING', 'PAID')
    END,
    pl.created_at,
    now()
FROM public.payment_links AS pl
WHERE pl.state_snapshot -> 'subscription' ->> 'kind' = 'subscription'
  -- Checkouts created from an existing MerchantPlan already have their canonical identity.
  AND NULLIF(pl.state_snapshot -> 'subscription' ->> 'planId', '') IS NULL
  AND COALESCE(pl.state_snapshot -> 'subscription' ->> 'intervalSeconds', '') ~ '^[1-9][0-9]{0,14}$'
  AND COALESCE(pl.state_snapshot -> 'subscription' ->> 'intervalCount', '') ~ '^[1-9][0-9]{0,2}$'
  AND (pl.state_snapshot -> 'subscription' ->> 'intervalCount')::integer <= 365
  AND (
      NULLIF(pl.state_snapshot -> 'subscription' ->> 'subscriber', '') IS NULL
      OR lower(pl.state_snapshot -> 'subscription' ->> 'subscriber') ~ '^0x[0-9a-f]{40}$'
  )
  AND NULLIF(pl.state_snapshot -> 'subscription' ->> 'beneficiary', '') IS NULL
  AND (
      pl.external_reference IS NULL
      OR NULLIF(pl.state_snapshot -> 'subscription' ->> 'subscriber', '') IS NOT NULL
  )
  AND pl.beneficiary_address IS NULL
  AND pl.payer_email IS NULL
  AND pl.receiver_address IS NULL
  AND pl.receiver_private_key IS NULL
  AND pl.invoice_number IS NULL
  AND pl.due_date IS NULL
ON CONFLICT (source_checkout_id) DO NOTHING;

-- Assigned legacy offers also need a durable inbox entry. Push delivery is intentionally
-- not attempted from SQL; the row is enough for the user's next inbox load, while all new
-- offers use the application helper and receive normal device notifications.
INSERT INTO public.subscript_dms (
    sender_address,
    receiver_address,
    message_type,
    status,
    amount_usdc,
    title,
    description,
    payment_link_id,
    dedupe_key,
    created_at,
    updated_at
)
SELECT
    lower(pl.merchant_address),
    lower(pl.state_snapshot -> 'subscription' ->> 'subscriber'),
    'SUBSCRIPTION_OFFER',
    'PENDING',
    pl.amount_usdc,
    left(COALESCE(NULLIF(btrim(pl.title), ''), 'Subscription') || ' subscription offer', 200),
    concat(
        'Plan: ', COALESCE(NULLIF(btrim(pl.title), ''), 'Subscription'), E'\n',
        'Amount: ', trim(trailing '.' FROM trim(trailing '0' FROM (pl.amount_usdc::numeric / 1000000)::text)),
        ' USDC every ',
        ((pl.state_snapshot -> 'subscription' ->> 'intervalSeconds')::bigint
            * (pl.state_snapshot -> 'subscription' ->> 'intervalCount')::bigint),
        ' seconds', E'\n',
        'Review the recurring terms, then accept or decline this plan.'
    ),
    pl.id,
    'subscription-offer:' || pl.id::text || ':' || lower(pl.state_snapshot -> 'subscription' ->> 'subscriber'),
    pl.created_at,
    now()
FROM public.payment_links AS pl
WHERE pl.active
  AND pl.status = 'PENDING'
  AND pl.state_snapshot -> 'subscription' ->> 'kind' = 'subscription'
  AND lower(COALESCE(pl.state_snapshot -> 'subscription' ->> 'subscriber', '')) ~ '^0x[0-9a-f]{40}$'
  AND COALESCE(pl.state_snapshot -> 'subscription' ->> 'intervalSeconds', '') ~ '^[1-9][0-9]{0,14}$'
  AND COALESCE(pl.state_snapshot -> 'subscription' ->> 'intervalCount', '') ~ '^[1-9][0-9]{0,2}$'
  AND NULLIF(pl.state_snapshot -> 'subscription' ->> 'beneficiary', '') IS NULL
  AND pl.beneficiary_address IS NULL
  AND pl.payer_email IS NULL
  AND pl.receiver_address IS NULL
  AND pl.receiver_private_key IS NULL
  AND pl.invoice_number IS NULL
  AND pl.due_date IS NULL
ON CONFLICT (dedupe_key) DO NOTHING;
