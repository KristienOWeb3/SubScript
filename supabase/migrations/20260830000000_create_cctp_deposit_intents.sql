-- Tracks which users intend to deposit USDC on which origin chain.
--
-- The keeper only scans derived deposit addresses that have active intents, so it does not waste
-- RPC calls querying every user on every chain every tick. When a user opens the deposit modal and
-- selects a CCTP chain, the frontend calls POST /api/user/cctp/intent which inserts a row here.
-- The sweepAndBridge() function reads active intents and checks for USDC balances.

CREATE TABLE IF NOT EXISTS cctp_deposit_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_wallet TEXT NOT NULL,
    derived_deposit_address TEXT NOT NULL,
    origin_chain_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'matched', 'expired')),
    matched_transfer_id UUID REFERENCES cctp_bridge_transfers(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The keeper query: find all derived addresses that need scanning.
CREATE INDEX IF NOT EXISTS idx_deposit_intents_active
    ON cctp_deposit_intents (derived_deposit_address, origin_chain_id)
    WHERE status = 'active';

-- User history lookup.
CREATE INDEX IF NOT EXISTS idx_deposit_intents_user
    ON cctp_deposit_intents (user_wallet, created_at DESC);
