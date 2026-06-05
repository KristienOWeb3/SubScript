/* 1. Dynamically drop existing check constraint on subscriptions.status */
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
    END LOOP;
END $$;

/* 2. Re-create the check constraint to include 'CANCELED' */
ALTER TABLE subscriptions 
    ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED', 'CANCELED'));

/* 3. Add column cancel_at_period_end (default false) */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;

/* 4. Add column cancel_requested_at (timestamptz, nullable) */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ NULL;

/* 5. Add column downgrade_failures (integer, default 0) */
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS downgrade_failures INT DEFAULT 0;
