/* SQL Migration for Hosted Payment Links, SBT Access Keys, and Batch Payouts */

/* 1. Add balance columns to merchants table */
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS available_balance_usdc BIGINT NOT NULL DEFAULT 0 CONSTRAINT check_available_balance_non_negative CHECK (available_balance_usdc >= 0);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reserved_balance_usdc BIGINT NOT NULL DEFAULT 0 CONSTRAINT check_reserved_balance_non_negative CHECK (reserved_balance_usdc >= 0);

/* 2. Add SBT token ID to subscriptions table */
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS sbt_token_id BIGINT UNIQUE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_sbt_token_idx ON subscriptions(sbt_token_id);

/* 3. Create payment_links table */
CREATE TABLE IF NOT EXISTS payment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    amount_usdc BIGINT NOT NULL CONSTRAINT check_payment_links_amount CHECK (amount_usdc > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ NULL,
    external_reference TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_links_merchant_idx ON payment_links(merchant_address);
CREATE INDEX IF NOT EXISTS payment_links_active_idx ON payment_links(active);

/* 4. Create payment_link_payments table */
CREATE TABLE IF NOT EXISTS payment_link_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_link_id UUID NOT NULL REFERENCES payment_links(id) ON DELETE CASCADE,
    payer_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CONSTRAINT check_payments_amount CHECK (amount_usdc > 0),
    tx_hash TEXT UNIQUE NOT NULL,
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    credited BOOLEAN NOT NULL DEFAULT false,
    credited_at TIMESTAMPTZ NULL,
    verification_block BIGINT NULL,
    verification_chain_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_link_payments_link_idx ON payment_link_payments(payment_link_id);
CREATE INDEX IF NOT EXISTS payment_link_payments_tx_hash_idx ON payment_link_payments(tx_hash);
CREATE INDEX IF NOT EXISTS payment_link_payments_merchant_idx ON payment_link_payments(merchant_address);

/* 5. Create sbt_mint_jobs table */
CREATE TABLE IF NOT EXISTS sbt_mint_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id BIGINT UNIQUE NOT NULL REFERENCES subscriptions(subscription_id) ON DELETE CASCADE,
    recipient_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CONSTRAINT check_mint_job_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    attempts INT DEFAULT 0,
    last_error TEXT,
    locked_at TIMESTAMPTZ NULL,
    locked_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sbt_mint_jobs_subscription_idx ON sbt_mint_jobs(subscription_id);
CREATE INDEX IF NOT EXISTS sbt_mint_jobs_status_idx ON sbt_mint_jobs(status);

/* 6. Create payout_batches table */
CREATE TABLE IF NOT EXISTS payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    status TEXT NOT NULL CONSTRAINT check_payout_batch_status CHECK (status IN ('PENDING', 'VALIDATING', 'READY', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    recipient_count INTEGER NOT NULL,
    total_amount_usdc BIGINT NOT NULL CONSTRAINT check_batch_total CHECK (total_amount_usdc > 0),
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_batches_merchant_idx ON payout_batches(merchant_address);
CREATE INDEX IF NOT EXISTS payout_batches_status_idx ON payout_batches(status);

/* 7. Create payout_batch_chunks table */
CREATE TABLE IF NOT EXISTS payout_batch_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    status TEXT NOT NULL CONSTRAINT check_payout_chunk_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    tx_hash TEXT NULL,
    recipient_count INTEGER NOT NULL,
    total_amount BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_batch_chunks_batch_idx ON payout_batch_chunks(batch_id);

/* 8. Create payout_batch_items table */
CREATE TABLE IF NOT EXISTS payout_batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
    chunk_id UUID NULL REFERENCES payout_batch_chunks(id) ON DELETE SET NULL,
    recipient_address TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL CONSTRAINT check_item_amount CHECK (amount_usdc > 0),
    status TEXT NOT NULL CONSTRAINT check_item_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    tx_hash TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_batch_items_batch_idx ON payout_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS payout_batch_items_recipient_idx ON payout_batch_items(recipient_address);
CREATE INDEX IF NOT EXISTS payout_batch_items_status_idx ON payout_batch_items(status);

/* 9. Create idempotency_keys table */
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CONSTRAINT check_idempotency_status CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
    response_payload JSONB NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idempotency_keys_key_idx ON idempotency_keys(execution_key);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys(expires_at);

/* 10. Create ledger_entries table */
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    entry_type TEXT NOT NULL CONSTRAINT check_ledger_entry_type CHECK (entry_type IN ('CREDIT_PAYMENT', 'CREDIT_PAYMENT_LINK', 'DEBIT_WITHDRAWAL', 'DEBIT_BATCH_PAYOUT', 'RESERVE', 'RELEASE')),
    amount_usdc BIGINT NOT NULL CONSTRAINT check_ledger_amount CHECK (amount_usdc > 0),
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    tx_hash TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_merchant_idx ON ledger_entries(merchant_address);

/* 11. Create webhook_deliveries table */
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    status TEXT NOT NULL CONSTRAINT check_webhook_delivery_status CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'DEAD_LETTER')),
    payload JSONB NOT NULL,
    signature_version TEXT NOT NULL DEFAULT 'v1',
    attempts INT DEFAULT 0,
    last_error TEXT,
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON webhook_deliveries(webhook_endpoint_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON webhook_deliveries(status);

/* 12. Create audit_events table */
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    ip_address TEXT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action);

/* 13. Enable Row-Level Security on all new tables */
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_link_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sbt_mint_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batch_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

/* 14. Add default deny policies for internal/admin tables */
CREATE POLICY "Deny public access on payment_link_payments" ON payment_link_payments FOR ALL USING (false);
CREATE POLICY "Deny public access on sbt_mint_jobs" ON sbt_mint_jobs FOR ALL USING (false);
CREATE POLICY "Deny public access on payout_batch_chunks" ON payout_batch_chunks FOR ALL USING (false);
CREATE POLICY "Deny public access on idempotency_keys" ON idempotency_keys FOR ALL USING (false);
CREATE POLICY "Deny public access on webhook_deliveries" ON webhook_deliveries FOR ALL USING (false);
CREATE POLICY "Deny public access on audit_events" ON audit_events FOR ALL USING (false);

/* 15. Create policies for merchants to select/edit their own payment links */
CREATE POLICY "Merchant select own payment links" ON payment_links FOR SELECT USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));
CREATE POLICY "Merchant insert own payment links" ON payment_links FOR INSERT WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));
CREATE POLICY "Merchant update own payment links" ON payment_links FOR UPDATE USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address')) WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));
CREATE POLICY "Merchant delete own payment links" ON payment_links FOR DELETE USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

/* 16. Create policy for public to view active and non-expired payment links */
CREATE POLICY "Public select active payment links" ON payment_links FOR SELECT USING (active = true AND (expires_at IS NULL OR expires_at > now()));

/* 17. Create policies for merchants to read their own payment_link_payments, payout_batches, payout_batch_items, ledger_entries */
DROP POLICY IF EXISTS "Deny public access on payment_link_payments" ON payment_link_payments;
CREATE POLICY "Merchant select own payment link payments" ON payment_link_payments FOR SELECT USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

CREATE POLICY "Merchant select own payout batches" ON payout_batches FOR SELECT USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

CREATE POLICY "Merchant select own payout batch items" ON payout_batch_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM payout_batches
        WHERE payout_batches.id = payout_batch_items.batch_id
          AND LOWER(payout_batches.merchant_address) = LOWER(auth.jwt() ->> 'wallet_address')
    )
);

CREATE POLICY "Merchant select own ledger entries" ON ledger_entries FOR SELECT USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));

/* 18. Auto-update trigger for updated_at column on updated tables */
CREATE OR REPLACE TRIGGER trigger_update_payment_links_updated_at
    BEFORE UPDATE ON payment_links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_payment_link_payments_updated_at
    BEFORE UPDATE ON payment_link_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_sbt_mint_jobs_updated_at
    BEFORE UPDATE ON sbt_mint_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_payout_batches_updated_at
    BEFORE UPDATE ON payout_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_payout_batch_chunks_updated_at
    BEFORE UPDATE ON payout_batch_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_idempotency_keys_updated_at
    BEFORE UPDATE ON idempotency_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_update_webhook_deliveries_updated_at
    BEFORE UPDATE ON webhook_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

/* 19. Add dynamic columns to system_settings for independent circuit breakers */
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS hosted_payments_enabled BOOLEAN DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS batch_payouts_enabled BOOLEAN DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sbt_minting_enabled BOOLEAN DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS webhook_dispatch_enabled BOOLEAN DEFAULT true;

/* 20. Lock merchant row PL/pgSQL function for row locking */
CREATE OR REPLACE FUNCTION lock_merchant_row(p_wallet_address TEXT)
RETURNS VOID AS $$
DECLARE
    v_dummy TEXT;
BEGIN
    SELECT wallet_address INTO v_dummy
    FROM merchants
    WHERE LOWER(wallet_address) = LOWER(p_wallet_address)
    FOR UPDATE;
END;
$$ LANGUAGE plpgsql;

