/* SQL Migration: Reset premium merchant tier to FREE and purge ZK keys */
ALTER TABLE merchants ALTER COLUMN tier TYPE TEXT USING tier::TEXT;
ALTER TABLE merchants ALTER COLUMN tier SET DEFAULT 'FREE';
UPDATE merchants SET tier = 'FREE', shielded_payouts_enabled = false, view_key_hash = NULL;
