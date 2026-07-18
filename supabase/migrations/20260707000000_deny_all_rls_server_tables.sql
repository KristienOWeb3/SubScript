-- Explicit deny-all RLS on server-only tables (checklist A7).
-- These tables are written/read exclusively server-side via the service role (which bypasses RLS).
-- They had RLS enabled but no policy — already deny-all in effect, but the Supabase advisor flags
-- "RLS enabled, no policy". Add the explicit `USING (false)` policy to match the rest of the schema
-- and clear the advisor. Idempotent.

do $$
declare
    t text;
begin
    foreach t in array array['_subscript_migrations', 'fiat_funding_intents', 'fiat_funding_events', 'referrals']
    loop
        if to_regclass('public.' || t) is not null then
            execute format('alter table public.%I enable row level security', t);
            execute format('drop policy if exists "Deny all public access" on public.%I', t);
            execute format('create policy "Deny all public access" on public.%I for all using (false)', t);
        end if;
    end loop;
end $$;
