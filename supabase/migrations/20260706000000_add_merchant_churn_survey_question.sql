-- Merchant-defined custom exit-survey question (SUB-501). When set, it replaces the default
-- "why did you cancel" prompt in the CHURN_SURVEY DM a customer sees on cancellation.
-- Nullable (null = use the default prompt). Idempotent; merchants table is already default-deny RLS.

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS churn_survey_question TEXT DEFAULT NULL;
