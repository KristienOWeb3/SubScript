/*
 * Value carried into a subscription's first billing window from the authorization it replaced.
 *
 * Upgrade credit must be priced on what was actually paid for the current window, never on the
 * plan's list price. Otherwise a free-trial or intro-price subscriber who upgrades on day one is
 * credited for a period they never paid for, and the merchant loses the difference. The chain
 * records the cash each sequence charged (chargeAmountFor). But an upgrade's reduced first
 * charge, or a resume's or downgrade's free deferred window, looks exactly like a promo price on
 * chain. The value that came across from the previous authorization only exists here.
 *
 * carried_credit_usdc_micros: unused value of the replaced authorization's window at the moment
 *   it was replaced, in integer micro-USDC. 0 for an ordinary subscribe.
 * carried_credit_since: when that value was carried in, i.e. the start of sequence 0's window.
 *   NULL means sequence 0 started one period before the chain's first nextPayment (ordinary
 *   create).
 *
 * Credit at time t for sequence 0 is (chargeAmountFor(sub, 0) + carried) * remaining / window
 * length, and chargeAmountFor(sub, s) * remaining / period for later sequences. See
 * src/lib/subscriptions/upgradeCheckout.ts.
 */
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS carried_credit_usdc_micros BIGINT NOT NULL DEFAULT 0
        CHECK (carried_credit_usdc_micros >= 0),
    ADD COLUMN IF NOT EXISTS carried_credit_since TIMESTAMPTZ;
