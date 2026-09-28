/*
 * Durable accounting for user-paid Arc gas reimbursements.
 *
 * This is operational cost recovery, not a peer/merchant payment or protocol revenue. The table
 * stays server-only; user-facing history receives a narrow projection through the deposits API.
 */
CREATE TABLE IF NOT EXISTS public.arc_network_fee_recoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL DEFAULT 'ARC_NETWORK_FEE'
        CHECK (transaction_type = 'ARC_NETWORK_FEE'),
    request_key TEXT NOT NULL
        CHECK (char_length(request_key) BETWEEN 8 AND 256),
    sender_wallet TEXT NOT NULL
        CHECK (sender_wallet ~ '^0x[0-9a-f]{40}$'),
    treasury_recipient TEXT NOT NULL
        CHECK (treasury_recipient ~ '^0x[0-9a-f]{40}$'),
    fee_micros BIGINT NOT NULL CHECK (fee_micros > 0),
    fee_tx_hash TEXT
        CHECK (fee_tx_hash IS NULL OR fee_tx_hash ~ '^0x[0-9a-f]{64}$'),
    parent_transaction_hashes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    recovery_status TEXT NOT NULL
        CHECK (recovery_status IN ('CHARGED', 'UNRECOVERED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT arc_network_fee_recoveries_request_key_unique UNIQUE (request_key),
    CONSTRAINT arc_network_fee_recoveries_fee_tx_hash_unique UNIQUE (fee_tx_hash),
    CONSTRAINT arc_network_fee_recoveries_parent_hashes_no_nulls CHECK (
        array_position(parent_transaction_hashes, NULL) IS NULL
    )
);

CREATE INDEX IF NOT EXISTS arc_network_fee_recoveries_sender_created_idx
    ON public.arc_network_fee_recoveries (sender_wallet, created_at DESC);

ALTER TABLE public.arc_network_fee_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.arc_network_fee_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.arc_network_fee_recoveries TO service_role, postgres;

DROP POLICY IF EXISTS "Deny all public access" ON public.arc_network_fee_recoveries;
CREATE POLICY "Deny all public access"
    ON public.arc_network_fee_recoveries
    FOR ALL
    USING (false)
    WITH CHECK (false);
