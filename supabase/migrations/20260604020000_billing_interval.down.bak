/* Drop trigger, function and column next_billing_date from subscriptions */
DROP TRIGGER IF EXISTS trigger_update_subscription_next_billing_date ON subscriptions;
DROP FUNCTION IF EXISTS update_subscription_next_billing_date();
ALTER TABLE subscriptions DROP COLUMN IF EXISTS next_billing_date;
