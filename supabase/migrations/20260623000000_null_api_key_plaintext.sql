/* SQL Migration: Phase B of hashing API secret keys at rest (DESTRUCTIVE).
 *
 * Removes the cleartext secret keys now that the hash is the source of truth.
 *
 * RUN THIS ONLY AFTER:
 *   1. Phase A (20260622000000_add_api_key_hash_columns.sql) has been applied, AND
 *   2. The hash-aware application code is deployed and verified (API-key auth confirmed working
 *      end-to-end against existing keys).
 *
 * After this runs, the plaintext is unrecoverable. Ensure a database backup exists first.
 * The hash-first/plaintext-fallback code continues to work because every key was hashed in Phase A.
 */

UPDATE api_keys SET secret_key_plain = NULL WHERE secret_key_plain IS NOT NULL;
