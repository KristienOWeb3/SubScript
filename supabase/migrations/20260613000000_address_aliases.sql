/* SQL Migration: Create address_aliases table and alter merchants.tier to TEXT if necessary */
CREATE TABLE IF NOT EXISTS address_aliases (
    address TEXT PRIMARY KEY,
    alias TEXT UNIQUE NOT NULL,
    is_anonymous BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE merchants ALTER COLUMN tier TYPE TEXT;
