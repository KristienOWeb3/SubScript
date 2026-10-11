-- Created before custody submission; provider ID is saved before polling confirmation.
create table public.settlement_receipt_jobs (
    id uuid primary key default gen_random_uuid(),
    identity text not null unique,
    kind text not null check (kind in ('wallet_transfer','vault_topup','vault_withdraw','vault_reclaim','vault_claim','router_withdraw','payout_change')),
    funding_wallet text not null,
    payer_address text,
    payee_address text,
    amount_usdc bigint check (amount_usdc is null or amount_usdc > 0),
    contract_address text not null,
    chain_id integer not null,
    provider_id uuid,
    tx_hash text,
    state text not null default 'prepared' check (state in ('prepared','submitted','confirmed','enqueued','failed','review')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    lease_token uuid,
    lease_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((lease_token is null) = (lease_until is null))
);
create index settlement_receipt_jobs_pending_idx on public.settlement_receipt_jobs(next_attempt_at)
    where state in ('prepared','submitted','confirmed');
alter table public.settlement_receipt_jobs enable row level security;
revoke all on public.settlement_receipt_jobs from public, anon, authenticated;
grant all on public.settlement_receipt_jobs to service_role;
