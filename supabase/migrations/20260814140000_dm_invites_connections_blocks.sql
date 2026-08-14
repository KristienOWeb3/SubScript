-- DM Invites, Peer Connections, Connection Requests, and Blocking tables.
-- Keeps direct invite links, requests, active peer relationships, and block controls
-- strictly segregated from subscript_dms.
--
-- Server-only tables: written and read through the service role.
-- RLS enabled with default-deny policy. Idempotent.

-- 1. dm_invite_settings: per-user invite token version, nonce, and enable/disable toggle
create table if not exists public.dm_invite_settings (
    wallet_address    text        primary key,
    token_version     integer     not null default 1,
    token_nonce       text        not null default gen_random_uuid()::text,
    enabled           boolean     not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

alter table public.dm_invite_settings
    drop constraint if exists dm_invite_settings_wallet_lowercase;
alter table public.dm_invite_settings
    add constraint dm_invite_settings_wallet_lowercase
    check (wallet_address = lower(wallet_address));

alter table public.dm_invite_settings enable row level security;
drop policy if exists "Deny all public access on dm_invite_settings" on public.dm_invite_settings;
create policy "Deny all public access on dm_invite_settings" on public.dm_invite_settings for all using (false);

-- 2. dm_connections: canonical accepted peer connections between two USER wallets
create table if not exists public.dm_connections (
    id                   uuid        primary key default gen_random_uuid(),
    user1_address        text        not null,
    user2_address        text        not null,
    status               text        not null default 'ACCEPTED',
    established_at       timestamptz not null default now(),
    last_interaction_at  timestamptz not null default now(),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

alter table public.dm_connections
    drop constraint if exists dm_connections_user1_lowercase;
alter table public.dm_connections
    add constraint dm_connections_user1_lowercase
    check (user1_address = lower(user1_address));

alter table public.dm_connections
    drop constraint if exists dm_connections_user2_lowercase;
alter table public.dm_connections
    add constraint dm_connections_user2_lowercase
    check (user2_address = lower(user2_address));

alter table public.dm_connections
    drop constraint if exists dm_connections_canonical_order;
alter table public.dm_connections
    add constraint dm_connections_canonical_order
    check (user1_address < user2_address);

alter table public.dm_connections
    drop constraint if exists dm_connections_status_check;
alter table public.dm_connections
    add constraint dm_connections_status_check
    check (status in ('ACCEPTED', 'TERMINATED'));

create unique index if not exists dm_connections_pair_idx
    on public.dm_connections (user1_address, user2_address);

create index if not exists dm_connections_user1_idx
    on public.dm_connections (user1_address, status);

create index if not exists dm_connections_user2_idx
    on public.dm_connections (user2_address, status);

alter table public.dm_connections enable row level security;
drop policy if exists "Deny all public access on dm_connections" on public.dm_connections;
create policy "Deny all public access on dm_connections" on public.dm_connections for all using (false);

-- 3. dm_requests: connection requests before acceptance (with decline cooldown & expiration)
create table if not exists public.dm_requests (
    id                uuid        primary key default gen_random_uuid(),
    sender_address    text        not null,
    receiver_address  text        not null,
    note              text,
    status            text        not null default 'PENDING',
    expires_at        timestamptz not null default (now() + interval '7 days'),
    declined_at       timestamptz,
    cooldown_until    timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

alter table public.dm_requests
    drop constraint if exists dm_requests_sender_lowercase;
alter table public.dm_requests
    add constraint dm_requests_sender_lowercase
    check (sender_address = lower(sender_address));

alter table public.dm_requests
    drop constraint if exists dm_requests_receiver_lowercase;
alter table public.dm_requests
    add constraint dm_requests_receiver_lowercase
    check (receiver_address = lower(receiver_address));

alter table public.dm_requests
    drop constraint if exists dm_requests_no_self_request;
alter table public.dm_requests
    add constraint dm_requests_no_self_request
    check (sender_address <> receiver_address);

alter table public.dm_requests
    drop constraint if exists dm_requests_status_check;
alter table public.dm_requests
    add constraint dm_requests_status_check
    check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'));

create unique index if not exists dm_requests_unique_pending_pair
    on public.dm_requests (sender_address, receiver_address)
    where status = 'PENDING';

create index if not exists dm_requests_receiver_status_idx
    on public.dm_requests (receiver_address, status, created_at desc);

create index if not exists dm_requests_sender_status_idx
    on public.dm_requests (sender_address, status, created_at desc);

create index if not exists dm_requests_cooldown_idx
    on public.dm_requests (sender_address, receiver_address, cooldown_until)
    where status = 'DECLINED';

alter table public.dm_requests enable row level security;
drop policy if exists "Deny all public access on dm_requests" on public.dm_requests;
create policy "Deny all public access on dm_requests" on public.dm_requests for all using (false);

-- 4. dm_blocks: peer blocking
create table if not exists public.dm_blocks (
    id                uuid        primary key default gen_random_uuid(),
    blocker_address   text        not null,
    blocked_address   text        not null,
    created_at        timestamptz not null default now()
);

alter table public.dm_blocks
    drop constraint if exists dm_blocks_blocker_lowercase;
alter table public.dm_blocks
    add constraint dm_blocks_blocker_lowercase
    check (blocker_address = lower(blocker_address));

alter table public.dm_blocks
    drop constraint if exists dm_blocks_blocked_lowercase;
alter table public.dm_blocks
    add constraint dm_blocks_blocked_lowercase
    check (blocked_address = lower(blocked_address));

alter table public.dm_blocks
    drop constraint if exists dm_blocks_no_self_block;
alter table public.dm_blocks
    add constraint dm_blocks_no_self_block
    check (blocker_address <> blocked_address);

create unique index if not exists dm_blocks_unique_pair
    on public.dm_blocks (blocker_address, blocked_address);

create index if not exists dm_blocks_blocker_idx
    on public.dm_blocks (blocker_address);

create index if not exists dm_blocks_blocked_idx
    on public.dm_blocks (blocked_address);

alter table public.dm_blocks enable row level security;
drop policy if exists "Deny all public access on dm_blocks" on public.dm_blocks;
create policy "Deny all public access on dm_blocks" on public.dm_blocks for all using (false);
