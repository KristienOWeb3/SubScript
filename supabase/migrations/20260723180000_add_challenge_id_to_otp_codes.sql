/* Add challenge_id UUID column to otp_codes table if missing. */
ALTER TABLE public.otp_codes
    ADD COLUMN IF NOT EXISTS challenge_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS otp_codes_challenge_id_idx
    ON public.otp_codes (challenge_id);
