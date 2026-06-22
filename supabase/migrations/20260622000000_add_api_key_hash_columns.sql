/* SQL Migration: Phase A of hashing API secret keys at rest (NON-DESTRUCTIVE).
 *
 * Context: api_keys.secret_key_plain stored merchant secret API keys in cleartext, and the API
 * authenticated by plaintext equality. Any backup, log capture, or service-role compromise would
 * expose every merchant secret key.
 *
 * This phase is safe to run against the CURRENTLY DEPLOYED code:
 *   - It ADDS secret_key_hash + secret_key_hint and backfills them from existing plaintext.
 *   - It DROPS the NOT NULL on secret_key_plain so the new code can create keys without storing
 *     cleartext.
 *   - It does NOT remove any plaintext. Old code (plaintext lookup) keeps working; new code
 *     (hash-first, plaintext fallback) also works.
 *
 * Phase B (20260623000000_null_api_key_plaintext.sql) nulls the plaintext, and must be run only
 * AFTER the hash-aware code is deployed and verified.
 */

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS secret_key_hash TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS secret_key_hint TEXT;

/* Backfill hash + display hint from existing plaintext so every current key authenticates by hash. */
UPDATE api_keys
SET
    secret_key_hash = encode(digest(secret_key_plain, 'sha256'), 'hex'),
    secret_key_hint = substring(secret_key_plain FROM 1 FOR 8) || '...' || right(secret_key_plain, 4)
WHERE secret_key_plain IS NOT NULL
  AND secret_key_hash IS NULL;

/* Allow new keys to be created with only the hash + hint (no cleartext at rest). */
ALTER TABLE api_keys ALTER COLUMN secret_key_plain DROP NOT NULL;

/* Authentication lookups are by hash. */
CREATE INDEX IF NOT EXISTS api_keys_secret_hash_idx ON api_keys(secret_key_hash);
