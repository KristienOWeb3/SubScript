-- Persist intent before the burn and its owned Circle identity before confirmation polling.
-- A stable provider ref also recovers acceptance when the callback or response was lost.
alter table public.cctp_bridge_transfers
    add column if not exists burn_provider_id uuid,
    add column if not exists burn_ref_id text,
    add column if not exists burn_started_at timestamptz,
    add column if not exists burn_mint_recipient text,
    add column if not exists burn_lookup_cursor text,
    add column if not exists withdrawal_steps jsonb not null default '{}'::jsonb;

create unique index if not exists cctp_outbound_burn_reference_key
    on public.cctp_bridge_transfers (burn_ref_id) where burn_ref_id is not null;
create unique index if not exists cctp_outbound_burn_provider_key
    on public.cctp_bridge_transfers (burn_provider_id) where burn_provider_id is not null;
create index if not exists cctp_outbound_burn_recovery_idx
    on public.cctp_bridge_transfers (updated_at)
    where direction = 'outbound_withdrawal' and burn_started_at is not null
      and status in ('pending_burn', 'pending_fee');
