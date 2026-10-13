-- Producers keep their original outbox/provider keys. This registry adds a shared,
-- atomic identity for one completed financial transaction per email recipient.
create table public.email_receipt_events (
    chain_id bigint not null check (chain_id > 0),
    tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
    recipient text not null check (recipient = lower(btrim(recipient))),
    identity text not null references public.email_outbox(identity) deferrable initially deferred,
    created_at timestamptz not null default now(),
    primary key (chain_id, tx_hash, recipient)
);
create index email_receipt_events_identity_idx on public.email_receipt_events(identity);
alter table public.email_receipt_events enable row level security;
revoke all on public.email_receipt_events from public, anon, authenticated;
grant all on public.email_receipt_events to service_role;

-- Legacy text has no chain in settlement receipts. Resolve it only from durable
-- records; a hash alone cannot distinguish testnet, mainnet or another chain.
create function public.email_receipt_event(message jsonb)
returns table(chain_id bigint, tx_hash text)
language plpgsql stable security invoker set search_path = '' as $$
declare
    subject text := coalesce(message->>'subject', '');
    body text := coalesce(message->>'text', '');
    markup text := coalesce(message->>'html', '');
    hash text;
    chain bigint;
    matches text[];
    reference text;
begin
    if message->>'category' is distinct from 'transactional' then return; end if;
    if message ? 'receiptEvent' then
        if jsonb_typeof(message->'receiptEvent') = 'object'
           and message#>>'{receiptEvent,chainId}' ~ '^[1-9][0-9]{0,14}$'
           and lower(message#>>'{receiptEvent,txHash}') ~ '^0x[0-9a-f]{64}$' then
            return query select (message#>>'{receiptEvent,chainId}')::bigint,
                lower(message#>>'{receiptEvent,txHash}');
        else
            raise exception 'EMAIL_RECEIPT_EVENT_INVALID';
        end if;
        return;
    end if;
    if subject ~ '^Deposit confirmed: [0-9,.]+ USDC on ' then
        matches := regexp_match(markup, 'href="https://(explorer\.arc\.io|arcscan\.app|testnet\.arcscan\.app)/tx/(0x[0-9a-fA-F]{64})"');
        if matches is not null then
            return query select case when matches[1] = 'testnet.arcscan.app' then 5042002::bigint else 5042::bigint end,
                lower(matches[2]);
            return;
        end if;
        -- Old bridge templates labelled the origin network while linking the
        -- destination mint hash on that origin explorer. Trust the bridge ledger.
        matches := regexp_match(markup, 'href="https://[a-zA-Z0-9.-]+/tx/(0x[0-9a-fA-F]{64})"');
        if matches is null then return; end if;
        hash := lower(matches[1]);
        select min(b.destination_chain_id::bigint) into chain
        from public.cctp_bridge_transfers b
        where lower(b.mint_tx_hash) = hash and b.direction = 'inbound_deposit'
          and b.destination_chain_id in ('5042', '5042002')
          and lower(b.mint_tx_hash) is distinct from lower(b.burn_tx_hash)
        having count(distinct b.destination_chain_id) = 1;
    elsif subject ~ '^(Your payment is confirmed|You received a payment): [0-9,.]+ USDC$' then
        matches := regexp_match(body, '(?:^|\n)Transaction: (0x[0-9a-fA-F]{64})(?:\n|$)');
        if matches is null then return; end if;
        hash := lower(matches[1]);
        select min(f.chain_id) into chain from (
            select j.chain_id::bigint from public.settlement_receipt_jobs j where lower(j.tx_hash) = hash
            union select r.chain_id::bigint from public.receipts r where lower(r.tx_hash) = hash
        ) f having count(distinct f.chain_id) = 1;
    elsif subject ~ '^(Your receipt|You got paid): ' then
        matches := regexp_match(body, '\(reference ([^)]+)\)$');
        if matches is null then return; end if;
        reference := matches[1];
        select r.chain_id, lower(r.tx_hash) into chain, hash
        from public.receipts r where r.receipt_id = reference;
    end if;
    if chain > 0 and hash ~ '^0x[0-9a-f]{64}$' then
        return query select chain, hash;
    end if;
end;
$$;
revoke all on function public.email_receipt_event(jsonb) from public, anon, authenticated;
grant execute on function public.email_receipt_event(jsonb) to service_role;

insert into public.email_receipt_events (chain_id, tx_hash, recipient, identity)
select distinct on (e.chain_id, e.tx_hash, lower(btrim(o.recipient)))
    e.chain_id, e.tx_hash, lower(btrim(o.recipient)), o.identity
from public.email_outbox o
cross join lateral public.email_receipt_event(o.message) e
order by e.chain_id, e.tx_hash, lower(btrim(o.recipient)), o.created_at, o.id;

create function public.claim_email_receipt_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
    event record;
    original_identity text := new.identity;
    candidate_identity text;
    claimed_identity text;
    existing_identity boolean;
begin
    select * into event from public.email_receipt_event(new.message);
    if not found then return new; end if;
    select exists(select 1 from public.email_outbox o where o.identity = original_identity)
        into existing_identity;
    select r.identity into claimed_identity from public.email_receipt_events r
    where r.chain_id = event.chain_id and r.tx_hash = event.tx_hash
      and r.recipient = lower(btrim(new.recipient));
    if found then
        if not existing_identity then new.identity := claimed_identity; end if;
        return new;
    end if;
    -- Records for legacy messages may become available after the original enqueue.
    -- Recover their original key when the second producer supplies the event.
    select o.identity into candidate_identity
    from public.email_outbox o
    cross join lateral public.email_receipt_event(o.message) e
    where lower(btrim(o.recipient)) = lower(btrim(new.recipient))
      and e.chain_id = event.chain_id and e.tx_hash = event.tx_hash
    order by o.created_at, o.id limit 1;
    insert into public.email_receipt_events as r (chain_id, tx_hash, recipient, identity)
    values (event.chain_id, event.tx_hash, lower(btrim(new.recipient)), coalesce(candidate_identity, original_identity))
    on conflict (chain_id, tx_hash, recipient) do update set identity = r.identity
    returning identity into claimed_identity;
    -- An existing primary key must keep its original payload and provider key,
    -- even when metadata is added on a retry of an older unknown-chain message.
    if not existing_identity then new.identity := claimed_identity; end if;
    return new;
end;
$$;
revoke all on function public.claim_email_receipt_event() from public, anon, authenticated;
grant execute on function public.claim_email_receipt_event() to service_role;
create trigger email_outbox_claim_receipt_event before insert on public.email_outbox
for each row execute function public.claim_email_receipt_event();

-- Delivered, attempted and pending history is deliberately preserved. Existing
-- duplicate pending rows require a separate review before suppressing any send.
