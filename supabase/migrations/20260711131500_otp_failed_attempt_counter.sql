/*
 * Per-code failed-attempt counter for login OTPs. The LOGIN verify path intentionally
 * compares before consuming (so a typo doesn't burn the code), but that left a 6-digit
 * code open to brute force across its 10-minute TTL via IP rotation. The verify route
 * now increments this counter on every wrong guess and invalidates the code after the
 * limit. (The wallet-export and email-binding flows already consume the code on any
 * attempt, so they need no counter.)
 */
ALTER TABLE public.otp_codes
    ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
