/* Introductory-pricing promotions for merchant plans.
 *
 * A promotion is a merchant-editable offer ATTACHED to a regular plan (never a second
 * cheaper plan): "40% off the first cycle", "9 USDC for 3 cycles", "first month free".
 * At subscribe time the applicable terms are snapshotted onto the subscription row and
 * authorized on-chain (SubScriptPSA.createSubscriptionWithIntroductoryTerms), so later
 * edits or deletion of the promotion can never change what an existing subscriber pays.
 *
 * Redemptions are claimed atomically (claim_promotion_redemption) BEFORE the on-chain
 * create, so a redemption cap can never be oversubscribed by concurrent signups; a claim
 * whose on-chain create never happened is released (release_promotion_redemption).
 */

CREATE TABLE IF NOT EXISTS public.merchant_plan_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL,
    plan_id UUID NOT NULL REFERENCES public.merchant_plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL
        CHECK (discount_type IN ('PERCENT', 'FIXED_PRICE', 'FREE_TRIAL')),
    /* For PERCENT: basis points OFF the regular price (4000 = 40% off => pay 60%). */
    discount_bps INTEGER
        CHECK (discount_bps IS NULL OR (discount_bps >= 1 AND discount_bps <= 10000)),
    /* Snapshot of the plan's regular price when the terms were (re)configured; plan
       prices are immutable, so this always matches merchant_plans.amount_usdc. */
    regular_amount_usdc BIGINT NOT NULL CHECK (regular_amount_usdc > 0),
    /* The exact integer micro-USDC charge per introductory cycle (0 = free trial). */
    introductory_amount_usdc BIGINT NOT NULL CHECK (introductory_amount_usdc >= 0),
    introductory_cycles INTEGER NOT NULL DEFAULT 1
        CHECK (introductory_cycles >= 1 AND introductory_cycles <= 36),
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    new_customers_only BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    /* A promotion must actually discount, and its window must be coherent. */
    CONSTRAINT merchant_plan_promotions_discounts
        CHECK (introductory_amount_usdc < regular_amount_usdc),
    CONSTRAINT merchant_plan_promotions_window
        CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at)
);

/* At most one ACTIVE promotion per plan, so "which offer applies" is unambiguous. */
CREATE UNIQUE INDEX IF NOT EXISTS merchant_plan_promotions_one_active_per_plan
    ON public.merchant_plan_promotions (plan_id)
    WHERE active;

CREATE INDEX IF NOT EXISTS merchant_plan_promotions_merchant_idx
    ON public.merchant_plan_promotions (merchant_address);

ALTER TABLE public.merchant_plan_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on merchant_plan_promotions"
    ON public.merchant_plan_promotions;
CREATE POLICY "Deny all public access on merchant_plan_promotions"
    ON public.merchant_plan_promotions
    FOR ALL
    USING (false)
    WITH CHECK (false);

/* One redemption per (promotion, subscriber) — the uniqueness IS the once-per-customer
   guarantee. subscription_id is stamped once the on-chain create confirms. */
CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID NOT NULL REFERENCES public.merchant_plan_promotions(id) ON DELETE CASCADE,
    subscriber_address TEXT NOT NULL,
    subscription_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promotion_redemptions_once_per_customer
        UNIQUE (promotion_id, subscriber_address)
);

CREATE INDEX IF NOT EXISTS promotion_redemptions_subscriber_idx
    ON public.promotion_redemptions (subscriber_address);

ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on promotion_redemptions"
    ON public.promotion_redemptions;
CREATE POLICY "Deny all public access on promotion_redemptions"
    ON public.promotion_redemptions
    FOR ALL
    USING (false)
    WITH CHECK (false);

/* Immutable snapshot of the authorized terms on the subscription itself. Billing,
   receipts and webhooks read the PHASE from these — never from the mutable promotion. */
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS promotion_id UUID,
    ADD COLUMN IF NOT EXISTS intro_amount_usdc BIGINT,
    ADD COLUMN IF NOT EXISTS intro_cycles INTEGER,
    ADD COLUMN IF NOT EXISTS first_regular_payment_at TIMESTAMPTZ;

/* Atomically claim one redemption: verifies the offer is live (active, inside its
   window, under its cap) and the subscriber has not redeemed it before, then counts
   the redemption — all under a row lock so concurrent signups cannot oversubscribe. */
CREATE OR REPLACE FUNCTION public.claim_promotion_redemption(
    p_promotion_id UUID,
    p_subscriber TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    promo RECORD;
    inserted BOOLEAN := false;
BEGIN
    IF p_promotion_id IS NULL OR p_subscriber IS NULL OR length(p_subscriber) = 0 THEN
        RAISE EXCEPTION 'invalid promotion redemption parameters';
    END IF;

    SELECT * INTO promo
    FROM public.merchant_plan_promotions
    WHERE id = p_promotion_id
    FOR UPDATE;

    IF NOT FOUND
        OR NOT promo.active
        OR (promo.starts_at IS NOT NULL AND promo.starts_at > NOW())
        OR (promo.expires_at IS NOT NULL AND promo.expires_at <= NOW())
        OR (promo.max_redemptions IS NOT NULL AND promo.redemption_count >= promo.max_redemptions)
    THEN
        RETURN false;
    END IF;

    INSERT INTO public.promotion_redemptions (promotion_id, subscriber_address)
    VALUES (p_promotion_id, lower(p_subscriber))
    ON CONFLICT (promotion_id, subscriber_address) DO NOTHING
    RETURNING true INTO inserted;

    IF NOT COALESCE(inserted, false) THEN
        RETURN false;
    END IF;

    UPDATE public.merchant_plan_promotions
    SET redemption_count = redemption_count + 1,
        updated_at = NOW()
    WHERE id = p_promotion_id;

    RETURN true;
END;
$$;

/* Release a claim whose on-chain subscription was never created (pre-broadcast failure).
   Only unconfirmed claims (no subscription_id) can be released. */
CREATE OR REPLACE FUNCTION public.release_promotion_redemption(
    p_promotion_id UUID,
    p_subscriber TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    removed BOOLEAN := false;
BEGIN
    DELETE FROM public.promotion_redemptions
    WHERE promotion_id = p_promotion_id
      AND subscriber_address = lower(p_subscriber)
      AND subscription_id IS NULL
    RETURNING true INTO removed;

    IF COALESCE(removed, false) THEN
        UPDATE public.merchant_plan_promotions
        SET redemption_count = GREATEST(redemption_count - 1, 0),
            updated_at = NOW()
        WHERE id = p_promotion_id;
        RETURN true;
    END IF;
    RETURN false;
END;
$$;

/* Bind a confirmed on-chain subscription to its redemption. */
CREATE OR REPLACE FUNCTION public.confirm_promotion_redemption(
    p_promotion_id UUID,
    p_subscriber TEXT,
    p_subscription_id BIGINT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.promotion_redemptions
    SET subscription_id = p_subscription_id
    WHERE promotion_id = p_promotion_id
      AND subscriber_address = lower(p_subscriber);
$$;

REVOKE ALL ON TABLE public.merchant_plan_promotions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.promotion_redemptions FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_promotion_redemption(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_promotion_redemption(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_promotion_redemption(UUID, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_promotion_redemption(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_promotion_redemption(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_promotion_redemption(UUID, TEXT, BIGINT) TO service_role;
