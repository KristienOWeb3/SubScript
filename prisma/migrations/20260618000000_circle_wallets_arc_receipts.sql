create table if not exists user_embedded_wallets (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    wallet_address text not null unique,
    encrypted_private_key text,
    created_at timestamptz not null default now()
);

alter table user_embedded_wallets
    add column if not exists provider text not null default 'circle_google',
    add column if not exists circle_wallet_id text,
    add column if not exists circle_user_id text,
    add column if not exists circle_blockchain text,
    add column if not exists google_subject text,
    add column if not exists updated_at timestamptz not null default now();

create unique index if not exists user_embedded_wallets_circle_wallet_id_idx
    on user_embedded_wallets(circle_wallet_id)
    where circle_wallet_id is not null;

create table if not exists receipts (
    receipt_id text primary key,
    payment_link_id uuid references payment_links(id) on delete set null,
    payment_link_payment_id uuid references payment_link_payments(id) on delete set null,
    tx_hash text not null unique,
    chain_id integer not null,
    memo_contract text not null,
    payer_address text not null,
    merchant_address text not null,
    amount_usdc bigint not null,
    memo_note text,
    share_url text not null,
    status text not null default 'PENDING',
    block_number bigint,
    log_index integer,
    confirmed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists receipts_payer_address_idx on receipts(payer_address);
create index if not exists receipts_merchant_address_idx on receipts(merchant_address);
create index if not exists receipts_status_idx on receipts(status);
create index if not exists receipts_payment_link_id_idx on receipts(payment_link_id);
