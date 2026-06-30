/*
 * Server-only sandbox ledger for NGN bank-transfer funding intents.
 * These tables are deliberately unavailable through the Supabase Data API:
 * all access is authenticated and owner-scoped by SubScript server routes.
 */

CREATE TABLE IF NOT EXISTS public.fiat_funding_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    destination_wallet TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'SUBSCRIPT_SANDBOX',
    provider_reference TEXT NOT NULL,
    fiat_currency TEXT NOT NULL DEFAULT 'NGN',
    fiat_amount_minor BIGINT NOT NULL,
    quote_rate_ngn_per_usdc_minor BIGINT NOT NULL,
    gross_usdc_micros BIGINT NOT NULL,
    fee_fiat_minor BIGINT NOT NULL DEFAULT 0,
    net_usdc_micros BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AWAITING_TRANSFER',
    bank_name TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    transfer_reference TEXT NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    settlement_tx_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fiat_funding_intents_positive_amount
        CHECK (fiat_amount_minor > 0),
    CONSTRAINT fiat_funding_intents_positive_rate
        CHECK (quote_rate_ngn_per_usdc_minor > 0),
    CONSTRAINT fiat_funding_intents_positive_quotes
        CHECK (
            gross_usdc_micros > 0
            AND fee_fiat_minor >= 0
            AND net_usdc_micros > 0
            AND net_usdc_micros <= gross_usdc_micros
        ),
    CONSTRAINT fiat_funding_intents_sandbox_provider
        CHECK (provider = 'SUBSCRIPT_SANDBOX'),
    CONSTRAINT fiat_funding_intents_ngn_only
        CHECK (fiat_currency = 'NGN'),
    CONSTRAINT fiat_funding_intents_status_valid
        CHECK (
            status IN (
                'AWAITING_TRANSFER',
                'SIMULATED_SETTLED',
                'EXPIRED',
                'CANCELLED',
                'FAILED'
            )
        ),
    CONSTRAINT fiat_funding_intents_sandbox_chain
        CHECK (destination_chain_id = 5042002),
    CONSTRAINT fiat_funding_intents_wallet_idempotency_key
        UNIQUE (wallet_address, idempotency_key),
    CONSTRAINT fiat_funding_intents_provider_reference_key
        UNIQUE (provider_reference),
    CONSTRAINT fiat_funding_intents_transfer_reference_key
        UNIQUE (transfer_reference),
    CONSTRAINT fiat_funding_intents_settlement_tx_hash_key
        UNIQUE (settlement_tx_hash)
);

CREATE TABLE IF NOT EXISTS public.fiat_funding_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_intent_id UUID NOT NULL
        REFERENCES public.fiat_funding_intents(id) ON DELETE RESTRICT,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processing_result TEXT,
    processing_error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fiat_funding_events_provider_event_id_key
        UNIQUE (provider_event_id)
);

CREATE INDEX IF NOT EXISTS fiat_funding_intents_owner_created_idx
    ON public.fiat_funding_intents (wallet_address, created_at);
CREATE INDEX IF NOT EXISTS fiat_funding_intents_owner_status_idx
    ON public.fiat_funding_intents (wallet_address, status);
CREATE UNIQUE INDEX IF NOT EXISTS fiat_funding_intents_one_active_per_wallet_idx
    ON public.fiat_funding_intents (wallet_address)
    WHERE status = 'AWAITING_TRANSFER';
CREATE INDEX IF NOT EXISTS fiat_funding_intents_provider_reference_idx
    ON public.fiat_funding_intents (provider, provider_reference);
CREATE INDEX IF NOT EXISTS fiat_funding_events_intent_created_idx
    ON public.fiat_funding_events (funding_intent_id, created_at);

ALTER TABLE public.fiat_funding_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiat_funding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiat_funding_intents_server_only
    ON public.fiat_funding_intents;
CREATE POLICY fiat_funding_intents_server_only
    ON public.fiat_funding_intents
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS fiat_funding_events_server_only
    ON public.fiat_funding_events;
CREATE POLICY fiat_funding_events_server_only
    ON public.fiat_funding_events
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

REVOKE ALL PRIVILEGES ON TABLE public.fiat_funding_intents
    FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.fiat_funding_events
    FROM anon, authenticated;
