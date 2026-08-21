-- Durable state for operational alerts, so an ops alert channel can be trusted.
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- getSponsorWalletStatus() has computed `underfunded` and `estimatedTopupsRemaining` since the
-- gas sponsor wallet shipped, and nothing ever alerted on either. When the production sponsor
-- wallet emptied, the commit flow rendered a bare "(error)" and no operator signal fired
-- anywhere: sponsored payments fail closed, which is correct, and therefore silent.
--
-- Alerting on it needs memory. A check that runs every 15 minutes and mails on every underfunded
-- read is filtered to trash inside a day, and the real outage goes invisible along with it. So
-- lib/sponsor/gasAlerts only mails on a CHANGE of state, re-mails on a cooldown while the
-- condition persists, and mails once more on recovery. All three need the last alerted state to
-- survive across serverless invocations, which is what this table is.
--
-- WHY POSTGRES AND NOT THE REDIS MIRROR
-- -------------------------------------
-- Redis in this codebase is a best-effort cache that the edge can reach (mirrorDelegatedAdmins,
-- mirrorPlatformFlags); Postgres is the source of truth. Alert suppression is not cache: an
-- evicted key, or an unconfigured UPSTASH_REDIS_REST_URL, silently switches the cooldown off and
-- mails every admin every 15 minutes, which is the exact failure this design exists to prevent.
-- Postgres also gives the one primitive the de-noising depends on and Upstash cannot express in a
-- single round trip: a conditional upsert, so two overlapping keeper runs cannot both send.
-- The caller already needs Postgres to resolve admin recipients, so this adds no new dependency.
--
-- Keyed by alert_key rather than one column per alert, because section 3.10 of
-- docs/email-audit.md lists several more silent-outage alerts still to build (KYC queue aging,
-- reconciliation backlog, velocity). Those reuse this table instead of migrating a column each.
--
-- RLS deny-all: written and read only by the server (service role), never by the browser.

CREATE TABLE IF NOT EXISTS public.ops_alert_state (
    alert_key        TEXT PRIMARY KEY,
    -- Severity vocabulary is owned by each alert's sender. 'ok' is the one reserved value and
    -- means "not firing", so a recovery notice is exactly the transition INTO 'ok'.
    state            TEXT NOT NULL,
    -- What the operator was last told, so psql or the console can answer "what is firing right
    -- now?" without re-reading the underlying system. Never holds a recipient address.
    detail           TEXT,
    -- When this alert last went from 'ok' to firing. Drives "it's been like this for N hours".
    first_alerted_at TIMESTAMPTZ,
    -- When mail last went out for it. Drives the cooldown.
    last_alerted_at  TIMESTAMPTZ,
    -- Refreshed on every check, including healthy ones, so a health check that has quietly
    -- stopped running is visible as a stale timestamp rather than as an absence of alerts.
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_alert_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on ops_alert_state" ON public.ops_alert_state;
CREATE POLICY "Deny all public access on ops_alert_state" ON public.ops_alert_state FOR ALL USING (false);
