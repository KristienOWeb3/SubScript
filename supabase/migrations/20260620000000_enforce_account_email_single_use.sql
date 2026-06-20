/* Enforce single-use account emails across embedded wallets and linked wallet profiles. */

CREATE UNIQUE INDEX IF NOT EXISTS user_embedded_wallets_email_lower_unique_idx
    ON user_embedded_wallets (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_unique_idx
    ON customers (lower(email))
    WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_account_email_reuse()
RETURNS trigger AS $$
DECLARE
    conflicting_wallet TEXT;
BEGIN
    IF NEW.email IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'user_embedded_wallets' THEN
        SELECT wallet_address INTO conflicting_wallet
          FROM customers
         WHERE email IS NOT NULL
           AND lower(email) = lower(NEW.email)
           AND lower(wallet_address) <> lower(NEW.wallet_address)
         LIMIT 1;
    ELSIF TG_TABLE_NAME = 'customers' THEN
        SELECT wallet_address INTO conflicting_wallet
          FROM user_embedded_wallets
         WHERE lower(email) = lower(NEW.email)
           AND lower(wallet_address) <> lower(NEW.wallet_address)
         LIMIT 1;
    END IF;

    IF conflicting_wallet IS NOT NULL THEN
        RAISE EXCEPTION 'Email is already associated with another SubScript account'
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_user_embedded_wallet_email_reuse ON user_embedded_wallets;
CREATE TRIGGER prevent_user_embedded_wallet_email_reuse
    BEFORE INSERT OR UPDATE OF email, wallet_address ON user_embedded_wallets
    FOR EACH ROW
    EXECUTE FUNCTION prevent_account_email_reuse();

DROP TRIGGER IF EXISTS prevent_customer_email_reuse ON customers;
CREATE TRIGGER prevent_customer_email_reuse
    BEFORE INSERT OR UPDATE OF email, wallet_address ON customers
    FOR EACH ROW
    EXECUTE FUNCTION prevent_account_email_reuse();
