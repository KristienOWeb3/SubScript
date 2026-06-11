/* SQL Migration: Reset premium merchant tier to FREE and purge ZK keys */
UPDATE merchants SET tier = 'FREE', shielded_payouts_enabled = false, view_key_hash = NULL;
