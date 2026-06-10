/* Supabase Database Migration: Automated Churn Recovery */
/* Creates customers and merchant_email_templates tables */

CREATE TABLE IF NOT EXISTS customers (
    wallet_address TEXT PRIMARY KEY,
    email VARCHAR(255) NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_email_templates (
    merchant_address TEXT PRIMARY KEY REFERENCES merchants(wallet_address) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    subject_line TEXT NOT NULL,
    body_content TEXT NOT NULL
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_access_policy ON merchant_email_templates
    FOR ALL
    USING (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'))
    WITH CHECK (LOWER(merchant_address) = LOWER(auth.jwt() ->> 'wallet_address'));
