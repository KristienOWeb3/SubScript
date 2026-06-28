-- Add an optional customer-facing description and a "view more" details link to
-- merchant subscription plans, so a subscriber can see what they're paying for on
-- the shareable /subscribe/[planId] page. Both nullable; existing plans keep working.
-- description is capped at 300 chars (also enforced in the API); details_url must be
-- an http(s) URL (validated in the API before insert).

ALTER TABLE merchant_plans
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS details_url TEXT;

ALTER TABLE merchant_plans
    DROP CONSTRAINT IF EXISTS merchant_plans_description_len;
ALTER TABLE merchant_plans
    ADD CONSTRAINT merchant_plans_description_len
    CHECK (description IS NULL OR char_length(description) <= 300);
