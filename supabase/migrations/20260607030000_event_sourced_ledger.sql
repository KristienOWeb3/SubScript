/* SQL Migration for Event-Sourced Ledger with bytea Storage, Double-Spend Guard Views, and Snapshots */

/* 1. Create event_log table */
CREATE TABLE IF NOT EXISTS event_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    sequence_number BIGINT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_entity_idx ON event_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS event_log_sequence_idx ON event_log(entity_id, sequence_number);

/* 2. Create system_snapshots table for state compaction */
CREATE TABLE IF NOT EXISTS system_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    sequence_offset BIGINT NOT NULL,
    state_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_snapshots_entity_idx ON system_snapshots(entity_type, entity_id);

/* 3. Re-create ledger_entries with status and bytea merchant_address */
/* Drop any views dependent on ledger_entries first if any exist */
DROP VIEW IF EXISTS merchant_spendable_balances;

/* Drop existing ledger_entries table to align schemas */
DROP TABLE IF EXISTS ledger_entries CASCADE;

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address BYTEA NOT NULL,
    entry_type TEXT NOT NULL CONSTRAINT check_ledger_entry_type CHECK (entry_type IN ('CREDIT_PAYMENT', 'CREDIT_PAYMENT_LINK', 'DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT', 'RESERVE', 'RELEASE')),
    status TEXT NOT NULL DEFAULT 'PENDING' CONSTRAINT check_ledger_status CHECK (status IN ('PENDING', 'FINALIZED', 'FAILED')),
    amount_usdc BIGINT NOT NULL CONSTRAINT check_ledger_amount CHECK (amount_usdc > 0),
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    tx_hash TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_merchant_bytea_idx ON ledger_entries(merchant_address);

/* 4. Create Double-Spend Guard View */
CREATE OR REPLACE VIEW merchant_spendable_balances AS
WITH credit_totals AS (
    SELECT merchant_address, SUM(amount_usdc) as settled_credits
    FROM ledger_entries
    WHERE entry_type IN ('CREDIT_PAYMENT', 'CREDIT_PAYMENT_LINK')
      AND status = 'FINALIZED'
    GROUP BY merchant_address
),
debit_finalized_totals AS (
    SELECT merchant_address, SUM(amount_usdc) as settled_debits
    FROM ledger_entries
    WHERE entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT')
      AND status = 'FINALIZED'
    GROUP BY merchant_address
),
debit_pending_totals AS (
    SELECT merchant_address, SUM(amount_usdc) as pending_debits
    FROM ledger_entries
    WHERE entry_type IN ('DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT', 'RESERVE')
      AND status = 'PENDING'
    GROUP BY merchant_address
)
SELECT 
    m.wallet_address,
    COALESCE(c.settled_credits, 0) - COALESCE(df.settled_debits, 0) as settled_balance,
    COALESCE(c.settled_credits, 0) - COALESCE(df.settled_debits, 0) - COALESCE(dp.pending_debits, 0) as spendable_balance
FROM merchants m
LEFT JOIN credit_totals c ON c.merchant_address = decode(substring(m.wallet_address from 3), 'hex')
LEFT JOIN debit_finalized_totals df ON df.merchant_address = decode(substring(m.wallet_address from 3), 'hex')
LEFT JOIN debit_pending_totals dp ON dp.merchant_address = decode(substring(m.wallet_address from 3), 'hex');

/* 5. Create transaction_verifications table for Phase C (SSE status stream) */
CREATE TABLE IF NOT EXISTS transaction_verifications (
    tx_hash TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'PENDING_CONFIRMATIONS', 'VERIFYING', 'CONFIRMED', 'FAILED')),
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    confirmations INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_verifications_status_idx ON transaction_verifications(status);

/* 6. State Compaction Cron Procedure */
CREATE OR REPLACE FUNCTION compact_event_log()
RETURNS VOID AS $$
DECLARE
    r RECORD;
    v_max_seq BIGINT;
    v_state JSONB;
BEGIN
    /* Loop over each active entity in event_log */
    FOR r IN SELECT DISTINCT entity_type, entity_id FROM event_log LOOP
        /* Get max sequence number */
        SELECT MAX(sequence_number) INTO v_max_seq
        FROM event_log
        WHERE entity_type = r.entity_type AND entity_id = r.entity_id;

        /* Build state payload based on entity type */
        IF r.entity_type = 'MERCHANT' THEN
            SELECT jsonb_build_object(
                'spendable_balance', spendable_balance,
                'settled_balance', settled_balance
            ) INTO v_state
            FROM merchant_spendable_balances
            WHERE wallet_address = r.entity_id;
        ELSE
            v_state := '{}'::jsonb;
        END IF;

        /* Insert snapshot and prune event_log */
        IF v_state IS NOT NULL THEN
            INSERT INTO system_snapshots (entity_id, entity_type, sequence_offset, state_payload)
            VALUES (r.entity_id, r.entity_type, v_max_seq, v_state);

            DELETE FROM event_log
            WHERE entity_type = r.entity_type 
              AND entity_id = r.entity_id 
              AND sequence_number <= v_max_seq;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
