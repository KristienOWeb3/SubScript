-- Fix: otp_codes is missing the created_at column on databases where it was first created by
-- 20260619020000_add_missing_auth_and_withdrawal_tables (without created_at). The later
-- 20260620010000_restore_otp_codes uses CREATE TABLE IF NOT EXISTS, so on those databases it was a
-- no-op and never added the column. The OTP send route (src/app/api/auth/otp/send/route.ts) writes
-- `created_at = now()` on every insert/upsert path, so a missing column makes every verification
-- code send fail with 500 "Failed to send OTP code" (column "created_at" of relation "otp_codes"
-- does not exist). Additive and idempotent; existing rows get now() at add time.
ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
