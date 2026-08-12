-- Per-recipient notification inbox, so the platform has somewhere to put an announcement other
-- than a direct message.
--
-- WHY THIS TABLE EXISTS. Admin broadcasts previously had two delivery paths and no durable
-- per-recipient record: a Web Push notification (fire-and-forget, invisible to anyone who never
-- granted permission or who reads the dashboard on a different device) and, for some flows, a
-- SubscriptDm row. Using DMs for platform announcements conflates two different things — a DM is
-- correspondence between a user and a merchant, and burying "scheduled maintenance on Sunday" in
-- that thread makes both harder to read. admin_broadcasts records that a send HAPPENED, in
-- aggregate; it cannot answer "what should this account see in its bell, and has it been read?".
--
-- AUDIENCE IS A COLUMN, NOT AN INFERENCE. One wallet can hold both a customer and a merchant
-- account, and the two dashboards have separate bells. A row is addressed to a (wallet, audience)
-- pair so a merchants-only announcement does not surface in that same wallet's user dashboard.
-- A broadcast to "both" therefore writes two rows for such a wallet — deliberately, because each
-- is read and dismissed independently.
--
-- read_at is nullable rather than a boolean so the read TIME is preserved; unread is the absence
-- of a timestamp. The partial index makes the unread-count query — issued on every dashboard load
-- and by far the hottest read here — an index-only scan over just the unread rows.
--
-- Server-only table: written and read exclusively through the service role, which bypasses RLS.
-- It still gets an explicit deny-all policy to match the rest of the schema and to keep the
-- Supabase advisor quiet about "RLS enabled, no policy" (see
-- 20260707000000_deny_all_rls_server_tables.sql). Idempotent.

create table if not exists public.account_notifications (
    id                uuid primary key default gen_random_uuid(),
    recipient_address text        not null,
    audience          text        not null,
    title             text        not null,
    body              text        not null,
    url               text,
    source            text        not null default 'ADMIN',
    -- Nullable and intentionally NOT a foreign key: a notification must outlive the broadcast row
    -- it came from, and system-generated rows have no broadcast at all.
    broadcast_id      uuid,
    read_at           timestamptz,
    created_at        timestamptz not null default now()
);

-- Addresses are stored lowercase everywhere in this schema; the constraint documents that so a
-- checksummed insert fails loudly here rather than silently never matching a lookup.
alter table public.account_notifications
    drop constraint if exists account_notifications_recipient_lowercase;
alter table public.account_notifications
    add constraint account_notifications_recipient_lowercase
    check (recipient_address = lower(recipient_address));

alter table public.account_notifications
    drop constraint if exists account_notifications_audience_check;
alter table public.account_notifications
    add constraint account_notifications_audience_check
    check (audience in ('USER', 'MERCHANT'));

-- The list query: one account's bell, newest first.
create index if not exists account_notifications_recipient_created_idx
    on public.account_notifications (recipient_address, audience, created_at desc);

-- The badge query. Partial, so it spans only unread rows.
create index if not exists account_notifications_unread_idx
    on public.account_notifications (recipient_address, audience)
    where read_at is null;

alter table public.account_notifications enable row level security;
drop policy if exists "Deny all public access" on public.account_notifications;
create policy "Deny all public access" on public.account_notifications for all using (false);
