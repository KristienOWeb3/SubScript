/*
 * Repairs server-only table exposure and restores reconciliation of sessions whose on-chain
 * upgrade succeeded before their database entitlement write completed.
 */

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        '_subscript_migrations',
        'fiat_funding_events',
        'fiat_funding_intents',
        'referrals'
    ]
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
                table_name
            );
        END IF;
    END LOOP;
END $$;

/* Future public-schema tables are server-only unless a later migration deliberately grants
   access and defines an RLS policy. */
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_pending_payment_sessions(batch_size INT)
RETURNS SETOF public.payment_sessions
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.payment_sessions
    SET status = 'PROCESSING',
        processing_started_at = now()
    WHERE session_id IN (
        SELECT session_id
        FROM public.payment_sessions
        WHERE (
            status IN ('PENDING', 'FAILED', 'NEEDS_RECONCILIATION')
            OR (status = 'PROCESSING' AND processing_started_at < now() - INTERVAL '10 minutes')
        )
          AND tx_hash IS NOT NULL
          AND processing_attempts < 5
        ORDER BY created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$;
