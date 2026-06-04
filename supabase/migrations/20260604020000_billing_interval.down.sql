/* Drop generated column next_billing_date from subscriptions */
ALTER TABLE subscriptions
DROP COLUMN IF EXISTS next_billing_date;
