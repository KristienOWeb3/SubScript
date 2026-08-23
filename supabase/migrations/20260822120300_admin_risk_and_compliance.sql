-- Risk and compliance: velocity alerts, sanctions/PEP and wallet screening, jurisdiction rules,
-- per-account sponsorship caps, and per-account rate-limit overrides.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Section 1.4 of docs/admin-capabilities-audit.md was the emptiest part of the console: five ❌
-- and two 🟡, and the note on the last row reads "this is the biggest compliance gap for
-- mainnet". Nothing watched for unusual volume, nothing screened an address against a sanctions
-- list, nothing recorded a jurisdiction decision, and the two partial rows were partial in the
-- same way — the mechanism existed in a library and no admin could see it.
--
-- WHY ALERTS ARE STORED RATHER THAN COMPUTED ON READ
-- -------------------------------------------------
-- A velocity screen could be a query over receipts every time the tab loads. Two reasons it is a
-- table instead. First, an alert has a lifecycle an admin owns: acknowledged, dismissed as
-- expected behaviour, escalated to a dispute. A recomputed list forgets every judgement and
-- re-raises the same alert forever, which is how alerting stops being read. Second, the
-- thresholds move, and an alert has to record the threshold that was in force when it fired —
-- otherwise last month's alerts are unreviewable after a tuning change.
--
-- WHY SCREENING IS ONE TABLE FOR THREE CHECKS
-- ------------------------------------------
-- Sanctions/PEP screening of an account, high-risk jurisdiction assessment, and tainted-funds
-- screening of an inbound transfer are three different questions with one shape: a subject, a
-- provider, a verdict, a reviewable decision. `subject_kind` distinguishes them. Three tables
-- would mean three console views and three places to notice that a provider stopped answering.
--
-- NO PROVIDER IS WIRED IN THIS MIGRATION, AND THAT IS DELIBERATE
-- -------------------------------------------------------------
-- Chainalysis, TRM, and Elliptic all cost money and need a contract. The provider column is TEXT
-- and 'MANUAL' is a first-class value, so screening works from day one as an operator-driven
-- record ("checked against the OFAC SDN list by hand, cleared, here is the note") and gains an
-- automated feed later without a schema change. A screening table that only works once a vendor
-- is signed is a screening table that is empty at launch, which is when the record matters most.
--
-- FAIL-CLOSED IS THE CALLER'S CHOICE, NOT THIS TABLE'S
-- --------------------------------------------------
-- A missing screening row means "not screened", never "clear". Callers that must block on it
-- (onboarding a merchant in a regulated flow) treat absence as a stop; callers that only display
-- it show "unscreened". Encoding a default here would make one of those two wrong.
--
-- All statements idempotent, one transaction, RLS deny-all.

-- ---------------------------------------------------------------------------
-- 1. Velocity and anomaly alerts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.risk_alerts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'VOLUME_SPIKE' | 'RAPID_SUBSCRIBE' | 'STRUCTURING' | 'NEW_ACCOUNT_HIGH_VALUE'
    -- | 'SPONSOR_ABUSE' | 'RECEIPT_INVITE_PATTERN' | 'MULTI_ACCOUNT_FUNDING'
    -- | 'FAILED_PAYMENT_BURST'. Validated in code (RISK_ALERT_KINDS).
    kind          TEXT NOT NULL,
    -- 'LOW' | 'MEDIUM' | 'HIGH'
    severity      TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    -- The account the alert is about. Lowercased. NULL for platform-wide anomalies.
    subject_address TEXT,
    -- 'USER' | 'MERCHANT' | 'IP' | 'PLATFORM' — what kind of subject, since one address can be
    -- both and the two read very differently.
    subject_kind  TEXT NOT NULL DEFAULT 'USER',
    -- The window the observation covers, e.g. '1h', '24h', '7d'.
    window_label  TEXT NOT NULL,
    -- What was seen and what would have been unremarkable. Both stored so the alert stays
    -- reviewable after the threshold is retuned — see the header.
    observed_value TEXT NOT NULL,
    threshold_value TEXT NOT NULL,
    -- Supporting evidence: the tx hashes, the counterparties, the per-bucket counts.
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'ESCALATED'
    status        TEXT NOT NULL DEFAULT 'OPEN',
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ,
    -- Why an admin decided this was fine. The most valuable field in the table: it is what stops
    -- the next person re-investigating the same benign merchant.
    disposition_note TEXT,
    -- Set when the alert became a dispute or a ban, so the outcome is traceable.
    escalated_to_type TEXT,
    escalated_to_id   TEXT,
    -- Idempotency for the detector. A screen that runs hourly must not raise the same finding
    -- every hour, so the detector composes a stable key (kind + subject + window bucket) and
    -- the unique index below turns a repeat into a no-op.
    dedupe_key    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_alerts_dedupe
    ON public.risk_alerts (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_queue
    ON public.risk_alerts (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_subject
    ON public.risk_alerts (subject_address, created_at DESC);

ALTER TABLE public.risk_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on risk_alerts" ON public.risk_alerts;
CREATE POLICY "Deny all public access on risk_alerts" ON public.risk_alerts FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 2. Compliance screenings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.compliance_screenings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'ACCOUNT' (sanctions/PEP on a wallet or person) | 'WALLET' (tainted-funds on an address)
    -- | 'TRANSACTION' (inbound USDC transfer)
    subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('ACCOUNT', 'WALLET', 'TRANSACTION')),
    subject_address TEXT NOT NULL,
    -- Set when subject_kind = 'TRANSACTION'.
    tx_hash        TEXT,
    -- 'MANUAL' | 'CHAINALYSIS' | 'TRM' | 'ELLIPTIC' | 'OFAC_SDN'. TEXT, not an enum — see the
-- header note on why no provider is wired yet.
    provider       TEXT NOT NULL DEFAULT 'MANUAL',
    provider_reference TEXT,
    -- 'PENDING' | 'CLEAR' | 'HIT' | 'INCONCLUSIVE' | 'ERROR'. A missing row is NOT 'CLEAR' —
    -- absence means unscreened, and each caller decides what that costs.
    verdict        TEXT NOT NULL DEFAULT 'PENDING',
    -- 0-100 where higher is worse, when the provider gives one. NULL for MANUAL.
    risk_score     INTEGER,
    -- Which lists or categories matched: ["OFAC SDN", "mixer", "darknet market"].
    matched_lists  JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Two-letter ISO country code, when known. Joined against jurisdiction_rules for the
    -- high-risk flag rather than duplicating the risk level here, so retuning a country's rating
    -- does not require rewriting history.
    country_code   TEXT,
    raw_response   JSONB,
    -- Human review of the machine verdict. A HIT that compliance cleared, or a CLEAR they
    -- overrode, is the row an auditor most wants to find.
    -- 'NONE' | 'CLEARED' | 'BLOCKED' | 'ESCALATED'
    review_decision TEXT NOT NULL DEFAULT 'NONE',
    reviewed_by    TEXT,
    reviewed_at    TIMESTAMPTZ,
    review_note    TEXT,
    -- Screenings go stale. NULL = no re-check scheduled.
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "What is the latest screening for this subject" — the read every gate makes.
CREATE INDEX IF NOT EXISTS idx_compliance_screenings_subject
    ON public.compliance_screenings (subject_kind, subject_address, created_at DESC);
-- The review queue: hits and inconclusives that nobody has ruled on.
CREATE INDEX IF NOT EXISTS idx_compliance_screenings_review
    ON public.compliance_screenings (verdict, review_decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_screenings_tx
    ON public.compliance_screenings (lower(tx_hash))
    WHERE tx_hash IS NOT NULL;

ALTER TABLE public.compliance_screenings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on compliance_screenings" ON public.compliance_screenings;
CREATE POLICY "Deny all public access on compliance_screenings" ON public.compliance_screenings FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 3. Jurisdiction rules
-- ---------------------------------------------------------------------------
-- kyc_verifications already stores a country_code per account and nothing ever consulted a policy
-- about it. One row per country, seeded empty: an unseeded table means "no jurisdiction policy",
-- which is honest, whereas shipping a hardcoded list would bake one company's legal opinion into
-- a migration.

CREATE TABLE IF NOT EXISTS public.jurisdiction_rules (
    country_code TEXT PRIMARY KEY,          -- ISO 3166-1 alpha-2, uppercase
    -- 'STANDARD' | 'ELEVATED' | 'HIGH' | 'PROHIBITED'
    risk_level   TEXT NOT NULL DEFAULT 'STANDARD'
                 CHECK (risk_level IN ('STANDARD', 'ELEVATED', 'HIGH', 'PROHIBITED')),
    -- Blocks onboarding outright. Separate from risk_level = 'PROHIBITED' because a country can
    -- be rated high-risk (extra diligence, allowed) without being closed.
    onboarding_blocked BOOLEAN NOT NULL DEFAULT false,
    -- Forces KYC even where the tier would not otherwise require it.
    requires_enhanced_kyc BOOLEAN NOT NULL DEFAULT false,
    -- The legal or policy basis. Not decoration: this is what makes the rating defensible.
    note         TEXT,
    updated_by   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT jurisdiction_rules_code_shape CHECK (country_code ~ '^[A-Z]{2}$')
);

ALTER TABLE public.jurisdiction_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on jurisdiction_rules" ON public.jurisdiction_rules;
CREATE POLICY "Deny all public access on jurisdiction_rules" ON public.jurisdiction_rules FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 4. Per-account sponsorship overrides
-- ---------------------------------------------------------------------------
-- The daily sponsorship limits in src/lib/sponsor/sponsorship.ts are global constants, so one
-- account draining sponsored gas could only be stopped by turning sponsorship off for everyone.
-- A row here caps or disables one account. Read through getSponsorshipOverride(); a missing row
-- means the global constants apply.

CREATE TABLE IF NOT EXISTS public.sponsorship_overrides (
    address           TEXT PRIMARY KEY,
    -- NULL means "use the global constant for this dimension", which is not the same as 0
    -- (meaning "no sponsored actions at all"). Both are legitimate settings.
    daily_action_limit INTEGER,
    daily_gas_cap_usdc BIGINT,
    -- Hard off, regardless of the caps above. Kept as its own column so an operator can disable
    -- an account without losing the caps they will want back when it is re-enabled.
    disabled          BOOLEAN NOT NULL DEFAULT false,
    reason            TEXT NOT NULL,
    set_by            TEXT NOT NULL,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sponsorship_overrides_non_negative
        CHECK ((daily_action_limit IS NULL OR daily_action_limit >= 0)
           AND (daily_gas_cap_usdc IS NULL OR daily_gas_cap_usdc >= 0))
);

ALTER TABLE public.sponsorship_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on sponsorship_overrides" ON public.sponsorship_overrides;
CREATE POLICY "Deny all public access on sponsorship_overrides" ON public.sponsorship_overrides FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- 5. Per-account rate-limit overrides
-- ---------------------------------------------------------------------------
-- The rate limiter's buckets are uniform, which forces one compromise in both directions: a
-- legitimate high-volume integrator gets throttled, and an abusive account gets the same
-- generous allowance as everyone else. `multiplier` rather than absolute numbers, so a route's
-- own tuning stays authoritative and an override scales it.

CREATE TABLE IF NOT EXISTS public.rate_limit_overrides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'ADDRESS' | 'IP' | 'API_KEY'
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('ADDRESS', 'IP', 'API_KEY')),
    subject     TEXT NOT NULL,
    -- Which limiter bucket, or NULL for every bucket. Free-form because bucket names are route
    -- literals, and validating them here would break the moment a route renames one.
    bucket      TEXT,
    -- >1 loosens, <1 tightens, 0 blocks entirely. Numeric rather than integer so 0.5 is sayable.
    multiplier  NUMERIC(6, 3) NOT NULL DEFAULT 1.0,
    reason      TEXT NOT NULL,
    set_by      TEXT NOT NULL,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rate_limit_overrides_multiplier_range
        CHECK (multiplier >= 0 AND multiplier <= 100)
);

-- One live override per (subject_kind, subject, bucket). coalesce so the all-buckets row (NULL)
-- participates in the uniqueness rather than being exempt from it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limit_overrides_subject
    ON public.rate_limit_overrides (subject_kind, lower(subject), coalesce(bucket, '*'));

ALTER TABLE public.rate_limit_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access on rate_limit_overrides" ON public.rate_limit_overrides;
CREATE POLICY "Deny all public access on rate_limit_overrides" ON public.rate_limit_overrides FOR ALL USING (false);
