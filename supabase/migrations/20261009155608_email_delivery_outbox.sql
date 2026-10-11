-- Server-only durable delivery. Never call provider acceptance 'delivered'.
create table public.email_outbox (
    id uuid primary key default gen_random_uuid(),
    identity text not null unique,
    category text not null check (category in ('security','transactional','lifecycle','ops')),
    recipient text not null,
    message jsonb not null,
    status text not null default 'pending' check (status in ('pending','sending','accepted','delivered','suppressed','failed','review')),
    attempts integer not null default 0 check (attempts >= 0),
    provider_id text unique,
    first_attempt_at timestamptz,
    ambiguous_since timestamptz,
    next_attempt_at timestamptz not null default now(),
    lease_token uuid,
    lease_until timestamptz,
    last_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((status = 'sending') = (lease_token is not null and lease_until is not null))
);
create index email_outbox_ready_idx on public.email_outbox(next_attempt_at,created_at) where status = 'pending';
create index email_outbox_expired_lease_idx on public.email_outbox(lease_until) where status = 'sending';
create table public.email_suppressions (
    recipient text primary key,
    reason text not null,
    created_at timestamptz not null default now()
);
create table public.email_delivery_events (
    event_id text primary key,
    provider_id text not null,
    event_type text not null,
    occurred_at timestamptz not null,
    received_at timestamptz not null default now()
);
create index email_delivery_events_provider_idx on public.email_delivery_events(provider_id);
create table public.email_provider_gate (
    provider text primary key,
    next_allowed_at timestamptz not null
);
create table public.email_recipient_rate (
    key text primary key,
    window_start timestamptz not null,
    sends integer not null check (sends > 0)
);
-- Immutable activation time avoids emailing historical deposits when enabling the worker.
create table public.email_deposit_scan_state (
    wallet_address text primary key,
    activated_at timestamptz not null default now(),
    last_scanned_at timestamptz,
    lease_until timestamptz,
    lease_token uuid
);
create table public.email_recovery_activation (
    purpose text primary key,
    activated_at timestamptz not null default now()
);
insert into public.email_recovery_activation (purpose) values ('bridge');
create table public.email_bridge_notifications (
    transfer_id uuid not null references public.cctp_bridge_transfers(id) on delete cascade,
    phase text not null check (phase in ('started','completed')),
    enqueued_at timestamptz not null default now(),
    primary key (transfer_id,phase)
);
-- Seed only known account wallets, with activation at deployment time.
insert into public.email_deposit_scan_state (wallet_address)
select lower(wallet_address) from public.user_embedded_wallets where wallet_address is not null
union select lower(wallet_address) from public.auth_identities where disabled_at is null
union select lower(wallet_address) from public.customers where wallet_address is not null
on conflict do nothing;
alter table public.email_outbox enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_delivery_events enable row level security;
alter table public.email_provider_gate enable row level security;
alter table public.email_recipient_rate enable row level security;
alter table public.email_deposit_scan_state enable row level security;
alter table public.email_recovery_activation enable row level security;
alter table public.email_bridge_notifications enable row level security;
revoke all on public.email_outbox, public.email_suppressions, public.email_delivery_events,
    public.email_provider_gate, public.email_recipient_rate, public.email_deposit_scan_state,
    public.email_recovery_activation, public.email_bridge_notifications from public, anon, authenticated;
grant all on public.email_outbox, public.email_suppressions, public.email_delivery_events,
    public.email_provider_gate, public.email_recipient_rate, public.email_deposit_scan_state,
    public.email_recovery_activation, public.email_bridge_notifications to service_role;
