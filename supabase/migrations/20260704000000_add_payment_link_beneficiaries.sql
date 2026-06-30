ALTER TABLE payment_links
    ADD COLUMN IF NOT EXISTS beneficiary_address TEXT;

ALTER TABLE payment_link_payments
    ADD COLUMN IF NOT EXISTS beneficiary_address TEXT;

ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS beneficiary_address TEXT;

CREATE INDEX IF NOT EXISTS payment_links_beneficiary_address_idx
    ON payment_links (beneficiary_address)
    WHERE beneficiary_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_link_payments_beneficiary_address_idx
    ON payment_link_payments (beneficiary_address)
    WHERE beneficiary_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS receipts_beneficiary_address_idx
    ON receipts (beneficiary_address)
    WHERE beneficiary_address IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payment_links_beneficiary_not_merchant'
          AND conrelid = 'payment_links'::regclass
    ) THEN
        ALTER TABLE payment_links
            ADD CONSTRAINT payment_links_beneficiary_not_merchant
            CHECK (
                beneficiary_address IS NULL
                OR LOWER(beneficiary_address) <> LOWER(merchant_address)
            );
    END IF;
END
$$;
