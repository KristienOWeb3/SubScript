-- Migration: 20261108200000_enable_missing_rls.sql
-- Finding: SEC-CRIT-02 - Enable missing RLS, revoke public permissions, and set default-deny policies
-- Tables:
--   - public.cctp_bridge_transfers
--   - public.cctp_deposit_intents
--   - public.support_tickets
--   - public.support_ticket_messages
-- Completely idempotent and safe for repeated execution.

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'cctp_bridge_transfers',
        'cctp_deposit_intents',
        'support_tickets',
        'support_ticket_messages'
    ]
    LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL THEN
            -- 1. Enable Row Level Security
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

            -- 2. Revoke all permissions from PUBLIC pseudo-role, anon, and authenticated client roles
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', tbl);

            -- 3. Drop existing deny-all policies if already present
            EXECUTE format('DROP POLICY IF EXISTS "Deny all public access" ON public.%I', tbl);
            EXECUTE format('DROP POLICY IF EXISTS deny_public ON public.%I', tbl);

            -- 4. Create explicit default-deny policy for all operations
            EXECUTE format('CREATE POLICY "Deny all public access" ON public.%I FOR ALL USING (false) WITH CHECK (false)', tbl);
        END IF;
    END LOOP;
END $$;
