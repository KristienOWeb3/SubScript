-- Provider-hosted KYC/KYB control plane.
-- Sensitive identity evidence remains with the provider; these tables store only
-- wallet-bound lifecycle metadata and opaque provider references.

CREATE TABLE public.kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL UNIQUE
        REFERENCES public.account_roles(address) ON DELETE RESTRICT,
    account_role TEXT NOT NULL
        CHECK (account_role IN ('USER', 'ENTERPRISE')),
    kind TEXT NOT NULL
        CHECK (kind IN ('INDIVIDUAL', 'BUSINESS')),
    country_code TEXT NOT NULL
        CHECK (country_code ~ '^[A-Z]{2}$'),
    provider TEXT NOT NULL
        CHECK (char_length(provider) BETWEEN 1 AND 50),
    provider_case_id TEXT UNIQUE
        CHECK (provider_case_id IS NULL OR char_length(provider_case_id) BETWEEN 1 AND 200),
    requested_level TEXT NOT NULL DEFAULT 'STANDARD'
        CHECK (requested_level IN ('STANDARD', 'ENHANCED')),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING',
            'IN_REVIEW',
            'NEEDS_INPUT',
            'APPROVED',
            'REJECTED',
            'EXPIRED',
            'REVOKED'
        )),
    reason_code TEXT
        CHECK (reason_code IS NULL OR (
            char_length(reason_code) BETWEEN 1 AND 100
            AND reason_code IN (
                'ADDITIONAL_INFORMATION_REQUIRED',
                'DOCUMENT_EXPIRED',
                'DOCUMENT_UNREADABLE',
                'IDENTITY_MISMATCH',
                'BUSINESS_DETAILS_MISMATCH',
                'UNSUPPORTED_JURISDICTION',
                'PROVIDER_REJECTED',
                'COMPLIANCE_REVIEW_FAILED',
                'APPROVAL_EXPIRED',
                'APPROVAL_REVOKED'
            )
        )),
    consent_version TEXT NOT NULL
        CHECK (char_length(consent_version) BETWEEN 1 AND 40),
    consented_at TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    provider_updated_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision INTEGER NOT NULL DEFAULT 1
        CHECK (revision > 0),
    CONSTRAINT kyc_verifications_role_kind_check CHECK (
        (account_role = 'USER' AND kind = 'INDIVIDUAL')
        OR (account_role = 'ENTERPRISE' AND kind = 'BUSINESS')
    ),
    CONSTRAINT kyc_verifications_status_reason_check CHECK (
        (status IN ('PENDING', 'IN_REVIEW', 'APPROVED') AND reason_code IS NULL)
        OR (
            status = 'NEEDS_INPUT'
            AND reason_code IN (
                'ADDITIONAL_INFORMATION_REQUIRED',
                'DOCUMENT_EXPIRED',
                'DOCUMENT_UNREADABLE',
                'IDENTITY_MISMATCH',
                'BUSINESS_DETAILS_MISMATCH'
            )
        )
        OR (
            status = 'REJECTED'
            AND reason_code IN (
                'IDENTITY_MISMATCH',
                'BUSINESS_DETAILS_MISMATCH',
                'UNSUPPORTED_JURISDICTION',
                'PROVIDER_REJECTED',
                'COMPLIANCE_REVIEW_FAILED'
            )
        )
        OR (status = 'EXPIRED' AND reason_code = 'APPROVAL_EXPIRED')
        OR (
            status = 'REVOKED'
            AND reason_code IN ('APPROVAL_REVOKED', 'COMPLIANCE_REVIEW_FAILED')
        )
    )
);

CREATE INDEX kyc_verifications_review_queue_idx
    ON public.kyc_verifications (status, created_at DESC);

CREATE TABLE public.kyc_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL
        REFERENCES public.kyc_verifications(id) ON DELETE RESTRICT,
    provider_event_id TEXT UNIQUE
        CHECK (provider_event_id IS NULL OR char_length(provider_event_id) BETWEEN 1 AND 200),
    actor_type TEXT NOT NULL
        CHECK (actor_type IN ('APPLICANT', 'ADMIN', 'PROVIDER', 'SYSTEM')),
    actor_id TEXT
        CHECK (actor_id IS NULL OR char_length(actor_id) BETWEEN 1 AND 200),
    from_status TEXT
        CHECK (from_status IS NULL OR from_status IN (
            'PENDING',
            'IN_REVIEW',
            'NEEDS_INPUT',
            'APPROVED',
            'REJECTED',
            'EXPIRED',
            'REVOKED'
        )),
    to_status TEXT NOT NULL
        CHECK (to_status IN (
            'PENDING',
            'IN_REVIEW',
            'NEEDS_INPUT',
            'APPROVED',
            'REJECTED',
            'EXPIRED',
            'REVOKED'
        )),
    reason_code TEXT
        CHECK (reason_code IS NULL OR reason_code IN (
            'ADDITIONAL_INFORMATION_REQUIRED',
            'DOCUMENT_EXPIRED',
            'DOCUMENT_UNREADABLE',
            'IDENTITY_MISMATCH',
            'BUSINESS_DETAILS_MISMATCH',
            'UNSUPPORTED_JURISDICTION',
            'PROVIDER_REJECTED',
            'COMPLIANCE_REVIEW_FAILED',
            'APPROVAL_EXPIRED',
            'APPROVAL_REVOKED'
        )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kyc_verification_events_verification_created_idx
    ON public.kyc_verification_events (verification_id, created_at DESC);

CREATE FUNCTION public.reject_kyc_verification_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'kyc_verification_events is append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER kyc_verification_events_append_only
BEFORE UPDATE OR DELETE ON public.kyc_verification_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_kyc_verification_event_mutation();

REVOKE ALL ON FUNCTION public.reject_kyc_verification_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_kyc_verification_event_mutation() FROM anon, authenticated;

ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all public access"
    ON public.kyc_verifications
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY "Deny all public access"
    ON public.kyc_verification_events
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON TABLE public.kyc_verifications FROM anon, authenticated;
REVOKE ALL ON TABLE public.kyc_verification_events FROM anon, authenticated;

-- The legacy shared-key toggle did not retain defensible provider evidence.
-- Record each reset before removing the badge authority.
INSERT INTO public.audit_events (
    actor,
    action,
    resource_type,
    resource_id,
    metadata
)
SELECT
    'system',
    'KYC_LEGACY_VERIFICATION_RESET',
    'MERCHANT',
    wallet_address,
    jsonb_build_object('verified', false)
FROM public.merchants
WHERE verified = true;

UPDATE public.merchants
SET verified = false,
    updated_at = now()
WHERE verified = true;
