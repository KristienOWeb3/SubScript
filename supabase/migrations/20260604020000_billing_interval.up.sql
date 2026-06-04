/* Add generated column next_billing_date to subscriptions */
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ
GENERATED ALWAYS AS (last_settlement_timestamp + (billing_interval_seconds * interval '1 second')) STORED;
