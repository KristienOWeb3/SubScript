/*
 * Distinguish SubScript Premium subscriptions (merchant -> SubScript) from customer
 * plan subscriptions (customer -> merchant) in the shared `subscriptions` mirror.
 *
 * Existing rows are all Premium, so the column defaults to 'PREMIUM' (back-filled by the
 * DEFAULT). The Premium billing cron and internal billing sweep filter on kind='PREMIUM'
 * so customer subscriptions are never run through merchant-tier logic. Customer rows are
 * written through by our own subscribe/change/cancel routes for display + plan-switch
 * detection (on-chain Chainlink Automation does the actual recurring billing).
 */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PREMIUM';

CREATE INDEX IF NOT EXISTS subscriptions_kind_idx ON subscriptions(kind);
CREATE INDEX IF NOT EXISTS subscriptions_subscriber_idx ON subscriptions(subscriber);
