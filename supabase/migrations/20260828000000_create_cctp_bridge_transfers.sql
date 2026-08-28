-- Ledger for inbound (deposit onto Arc) and outbound (withdraw off Arc) CCTP transfers.
--
-- The protocol bridge fee is taken as a separate USDC transfer to the treasury before the CCTP burn,
-- so fee_amount_micros is money that actually moved and net_amount_micros is what was burned. CCTP
-- mints one-for-one, which makes net_amount_micros exactly what the destination receives.
CREATE TABLE IF NOT EXISTS cctp_bridge_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    direction TEXT NOT NULL CHECK (direction IN ('inbound_deposit', 'outbound_withdrawal')),
    user_wallet TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    origin_chain_id TEXT NOT NULL,
    origin_domain INTEGER NOT NULL,
    destination_chain_id TEXT NOT NULL,
    destination_domain INTEGER NOT NULL,
    gross_amount_micros NUMERIC(20, 0) NOT NULL CHECK (gross_amount_micros > 0),
    fee_amount_micros NUMERIC(20, 0) NOT NULL CHECK (fee_amount_micros >= 0),
    net_amount_micros NUMERIC(20, 0) NOT NULL CHECK (net_amount_micros > 0),
    fee_bps INTEGER NOT NULL DEFAULT 50,
    -- The treasury transfer that collected the fee. Null only when the fee tier is 0.
    fee_tx_hash TEXT,
    -- Null until the burn is submitted. A row is written before anything irreversible happens so a
    -- burn can never end up unrecorded, which is why this is nullable rather than NOT NULL.
    burn_tx_hash TEXT UNIQUE,
    message_bytes TEXT,
    message_hash TEXT,
    attestation_bytes TEXT,
    mint_tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending_burn' CHECK (status IN (
        'pending_burn', 'pending_fee', 'pending_attestation', 'minting', 'completed', 'failed'
    )),
    -- Bounds the keeper's retries. Without it a transfer whose mint reverts is re-submitted on every
    -- tick forever and never surfaces to anyone.
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The fee split has to add up, on every row, forever.
    CONSTRAINT cctp_bridge_amounts_balance CHECK (gross_amount_micros = fee_amount_micros + net_amount_micros)
);

-- Columns added after the first cut of this table; guarded so a re-run is a no-op.
ALTER TABLE cctp_bridge_transfers ADD COLUMN IF NOT EXISTS fee_tx_hash TEXT;
ALTER TABLE cctp_bridge_transfers ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cctp_bridge_transfers ALTER COLUMN burn_tx_hash DROP NOT NULL;
ALTER TABLE cctp_bridge_transfers ALTER COLUMN message_bytes DROP NOT NULL;
ALTER TABLE cctp_bridge_transfers ALTER COLUMN message_hash DROP NOT NULL;

DO $$
BEGIN
    ALTER TABLE cctp_bridge_transfers DROP CONSTRAINT IF EXISTS cctp_bridge_transfers_status_check;
    ALTER TABLE cctp_bridge_transfers
        ADD CONSTRAINT cctp_bridge_transfers_status_check
        CHECK (status IN ('pending_burn', 'pending_fee', 'pending_attestation', 'minting', 'completed', 'failed'));

    -- Also applied to a table left over from the first cut of this migration, which was created
    -- without it.
    ALTER TABLE cctp_bridge_transfers DROP CONSTRAINT IF EXISTS cctp_bridge_amounts_balance;
    ALTER TABLE cctp_bridge_transfers
        ADD CONSTRAINT cctp_bridge_amounts_balance
        CHECK (gross_amount_micros = fee_amount_micros + net_amount_micros);
END $$;

-- The keeper's only query: rows waiting on Circle or on a destination mint.
CREATE INDEX IF NOT EXISTS idx_cctp_bridge_pending
ON cctp_bridge_transfers(created_at)
WHERE status IN ('pending_attestation', 'minting');

-- Wallet history lookup, for both sides of a transfer.
CREATE INDEX IF NOT EXISTS idx_cctp_bridge_user
ON cctp_bridge_transfers(user_wallet, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cctp_bridge_recipient
ON cctp_bridge_transfers(recipient_address, created_at DESC);
