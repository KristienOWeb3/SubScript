/* Keep Arc memo data opaque while mapping each payment to its off-chain checkout session. */
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS receipt_token TEXT;

ALTER TABLE payment_links
    ALTER COLUMN receipt_token SET DEFAULT ('rcpt-' || encode(gen_random_bytes(16), 'hex'));

UPDATE payment_links
SET receipt_token = 'rcpt-' || replace(id::text, '-', '')
WHERE receipt_token IS NULL;

ALTER TABLE payment_links
    ALTER COLUMN receipt_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_links_receipt_token_idx
    ON payment_links(receipt_token);
