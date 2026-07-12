/* 1. Remove columns */
ALTER TABLE subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS cancel_requested_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS downgrade_failures;

/* 2. Dynamically drop status check constraint */
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'CHECK' 
          AND tc.table_name = 'subscriptions'
          AND ccu.column_name = 'status'
    LOOP
        EXECUTE 'ALTER TABLE subscriptions DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END FOR;
END $$;

/* 3. Restore original status check constraint */
ALTER TABLE subscriptions 
    ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED'));
