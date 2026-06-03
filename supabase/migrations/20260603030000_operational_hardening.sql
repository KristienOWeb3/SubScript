-- 0. Create the base table if it doesn't exist
CREATE TABLE IF NOT EXISTS private_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    destination TEXT, -- The alter script below will rename this to destination_address
    amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_upgrade_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 1. Alter private_withdrawals table to add metadata, snapshots, and check constraints
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'private_withdrawals' AND column_name = 'destination'
    ) THEN
        ALTER TABLE private_withdrawals RENAME COLUMN destination TO destination_address;
    END IF;
END $$;

ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS block_number BIGINT DEFAULT NULL;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS chain_id INT DEFAULT NULL;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS merchant_balance_before NUMERIC DEFAULT 0;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS merchant_balance_after NUMERIC DEFAULT 0;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS router_balance_before NUMERIC DEFAULT 0;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS router_balance_after NUMERIC DEFAULT 0;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS session_id UUID DEFAULT NULL;
ALTER TABLE private_withdrawals ADD COLUMN IF NOT EXISTS rpc_endpoint TEXT DEFAULT NULL;

-- Enforce clean lifecycle statuses
ALTER TABLE private_withdrawals DROP CONSTRAINT IF EXISTS check_withdrawal_status;
ALTER TABLE private_withdrawals ADD CONSTRAINT check_withdrawal_status CHECK (status IN ('PENDING', 'BROADCASTED', 'CONFIRMED', 'FAILED'));

-- 2. Alter premium_upgrade_events to add rpc endpoint auditing
ALTER TABLE premium_upgrade_events ADD COLUMN IF NOT EXISTS rpc_endpoint TEXT DEFAULT NULL;

-- 3. Create system_settings single-row table with audit metadata
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY DEFAULT 1 CONSTRAINT single_row CHECK (id = 1),
    premium_enabled BOOLEAN DEFAULT true,
    withdrawals_enabled BOOLEAN DEFAULT true,
    private_routing_enabled BOOLEAN DEFAULT true,
    deposits_enabled BOOLEAN DEFAULT true,
    checkout_enabled BOOLEAN DEFAULT true,
    reconciliation_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by TEXT DEFAULT 'system'
);

-- Enable RLS and deny public access on settings configurations
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Drop the policy if it exists first so you don't get an error running this script multiple times
DROP POLICY IF EXISTS "Deny all public access on system_settings" ON system_settings;
CREATE POLICY "Deny all public access on system_settings" ON system_settings FOR ALL USING (false);

-- Seed initial configuration
INSERT INTO system_settings (
    id, premium_enabled, withdrawals_enabled, private_routing_enabled, deposits_enabled, checkout_enabled, reconciliation_enabled
) VALUES (
    1, true, true, true, true, true, true
) ON CONFLICT (id) DO NOTHING;
