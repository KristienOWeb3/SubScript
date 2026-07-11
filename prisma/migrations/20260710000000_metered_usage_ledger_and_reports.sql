-- Option 3 metered-vault transparency (DigitalOcean-style visibility).
-- Adds an append-only usage ledger, threshold-notification bookkeeping, and a commit-merchant
-- scam-report table. Deliberately NO dispute/freeze on the keeper draw: a user-blockable draw plus
-- the contract's 7-day reclaim grace would let a user consume the service, dispute the bill, and
-- reclaim the full escrow. Protection here is transparency + an informed-consent warning at commit
-- + reputation (reports), not a draw veto. Idempotent.

-- 1. Append-only usage ledger: one row per report-usage accrual, user-visible.
create table if not exists public.metered_usage_reports (
    id                 uuid primary key default gen_random_uuid(),
    vault_id           uuid not null references public.metered_vaults(id) on delete cascade,
    user_address       text not null,
    merchant_address   text not null,
    amount_usdc        bigint not null,
    accrued_after_usdc bigint not null,
    balance_usdc       bigint not null,
    note               text,
    request_id         text,
    created_at         timestamptz not null default now()
);
create index if not exists metered_usage_reports_user_idx on public.metered_usage_reports (user_address, created_at desc);
create index if not exists metered_usage_reports_merchant_idx on public.metered_usage_reports (merchant_address, created_at desc);
create index if not exists metered_usage_reports_vault_idx on public.metered_usage_reports (vault_id, created_at desc);

-- 2. Threshold-notification bookkeeping: the highest balance-usage threshold (in bps) already
--    DM'd this cycle, so 50%/80% alerts fire once each and re-arm when the cycle resets.
alter table public.metered_vaults add column if not exists usage_notified_bps integer not null default 0;

-- 3. Commit-merchant scam reports. For SubScript ops review only; never affects the draw.
create table if not exists public.merchant_reports (
    id               uuid primary key default gen_random_uuid(),
    merchant_address text not null,
    reporter_address text not null,
    reason           text not null,
    detail           text,
    status           text not null default 'OPEN',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (merchant_address, reporter_address)
);
create index if not exists merchant_reports_merchant_idx on public.merchant_reports (merchant_address, status);

-- Deny-all RLS on the new server-only tables (service role bypasses). Matches repo convention.
do $$
declare t text;
begin
    foreach t in array array['metered_usage_reports', 'merchant_reports']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists "Deny all public access" on public.%I', t);
        execute format('create policy "Deny all public access" on public.%I for all using (false)', t);
    end loop;
end $$;
