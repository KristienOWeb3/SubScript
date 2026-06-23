-- Merchant-controlled churn (exit) survey. When false, no CHURN_SURVEY DM or exit
-- survey email is sent when a customer cancels. Defaults true (preserves current
-- behavior). Idempotent and RLS-unchanged (merchants table already default-deny).

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS churn_survey_enabled BOOLEAN NOT NULL DEFAULT true;
