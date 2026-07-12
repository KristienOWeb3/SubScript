/* Add next_billing_date column to subscriptions */
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ;

/* Create trigger function to automatically calculate next_billing_date */
CREATE OR REPLACE FUNCTION update_subscription_next_billing_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_settlement_timestamp IS NOT NULL AND NEW.billing_interval_seconds IS NOT NULL THEN
        NEW.next_billing_date := NEW.last_settlement_timestamp + (NEW.billing_interval_seconds * INTERVAL '1 second');
    ELSE
        NEW.next_billing_date := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* Create trigger to execute the calculation before insert or update */
CREATE OR REPLACE TRIGGER trigger_update_subscription_next_billing_date
    BEFORE INSERT OR UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_subscription_next_billing_date();
