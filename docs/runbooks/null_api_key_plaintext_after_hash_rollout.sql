/* Manual runbook SQL: Phase B of hashing API secret keys at rest (DESTRUCTIVE).
 *
 * Do not place this file under supabase/migrations until you are ready to permanently remove
 * plaintext API secrets. If this lives in supabase/migrations too early, `supabase db push` may
 * apply Phase A and Phase B together and break the intended zero-downtime rollout.
 *
 * RUN THIS ONLY AFTER:
 *   1. supabase/migrations/20260622000000_add_api_key_hash_columns.sql has been applied.
 *   2. The hash-aware application code is deployed.
 *   3. API-key authentication has been smoke-tested against an existing merchant key.
 *   4. A database backup or table backup exists.
 *
 * Recommended backup:
 *   create table api_keys_backup_20260623 as table api_keys;
 *
 * After this runs, secret_key_plain values are unrecoverable except from that backup.
 */

UPDATE api_keys
SET secret_key_plain = NULL
WHERE secret_key_plain IS NOT NULL;

/* Verification:
select count(*) total, count(secret_key_hash) hashed, count(secret_key_plain) plaintext_remaining
from api_keys;
*/
