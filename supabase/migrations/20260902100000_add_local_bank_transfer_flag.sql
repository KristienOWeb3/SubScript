-- Add local_bank_transfer_enabled column to platform_flags table
ALTER TABLE platform_flags ADD COLUMN IF NOT EXISTS local_bank_transfer_enabled BOOLEAN NOT NULL DEFAULT true;

