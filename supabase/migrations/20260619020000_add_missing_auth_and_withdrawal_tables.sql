create table if not exists public.otp_codes (
    email text primary key,
    code text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists otp_codes_expires_at_idx
    on public.otp_codes (expires_at);

alter table public.otp_codes enable row level security;

create table if not exists public.private_withdrawals (
    id uuid primary key default gen_random_uuid(),
    merchant_address text not null,
    destination_address text not null,
    amount numeric,
    commitment_hash text not null,
    nullifier_hash text not null unique,
    withdrawal_tx_hash text,
    status text not null default 'PENDING',
    error_message text,
    completed_at timestamptz,
    proof_type text not null default 'commit_reveal',
    rpc_endpoint text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists private_withdrawals_merchant_address_idx
    on public.private_withdrawals (merchant_address);

create index if not exists private_withdrawals_withdrawal_tx_hash_idx
    on public.private_withdrawals (withdrawal_tx_hash);

create index if not exists private_withdrawals_status_idx
    on public.private_withdrawals (status);

alter table public.private_withdrawals enable row level security;
