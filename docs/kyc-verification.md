# KYC and KYB verification

SubScript includes a provider-hosted verification control plane. It binds a case to the authenticated wallet and authoritative account role, records consent, normalizes provider/manual decisions, keeps append-only transition history, and synchronizes approved business cases to the existing public merchant badge.

It is intentionally not an identity-document store. Legal names, dates of birth, addresses, government identifiers, document images, selfies, biometrics, sanctions/PEP results, and raw provider payloads must not be sent to `/api/kyc` or `/api/admin/kyc`.

## Applicant flow

1. The authenticated account opens Identity verification in its dashboard.
2. It supplies only a two-letter country code and explicit consent.
3. `POST /api/kyc` derives the wallet and `USER`/`ENTERPRISE` role from server-side session state.
4. The API creates a `PENDING` individual KYC or business KYB case.
5. When `KYC_PROVIDER_PORTAL_URL` is configured, the dashboard opens that provider-hosted portal. The provider must collect sensitive evidence directly.
6. The applicant can refresh normalized status through `GET /api/kyc`.

No row means `NOT_STARTED`. Applicants may resubmit only cases in `NEEDS_INPUT`, `REJECTED`, `EXPIRED`, or `REVOKED`.

## Reviewer flow

`GET /api/admin/kyc` lists the review queue. `POST /api/admin/kyc` records controlled decisions using `ADMIN_API_KEY` in either the bearer or `x-admin-api-key` header.

Production reviewers must make identity decisions in the licensed provider console. The SubScript endpoint records only the provider case reference, normalized target status, controlled reason code, and optional expiry. Free-form notes are rejected.

The old `/api/admin/merchant-verification` toggle is retired. An enterprise merchant is publicly verified only while its business case is `APPROVED`.

## Configuration

```dotenv
KYC_PROVIDER_NAME=manual
KYC_PROVIDER_PORTAL_URL=
KYC_CONSENT_VERSION=2026-07-04
ADMIN_API_KEY=
```

`KYC_PROVIDER_PORTAL_URL` is optional for local/manual review. A production provider adapter still needs:

- server-created hosted sessions bound to SubScript case IDs;
- signed webhooks verified over raw request bytes;
- replay and event-id protection;
- authoritative status retrieval so stale webhooks cannot regress a case;
- expiration/revocation reconciliation;
- documented jurisdiction, sanctions/PEP, liveness, KYB, retention, and reviewer-access policy.

## Data and security boundaries

- Both KYC tables are server-only with RLS enabled and `anon`/`authenticated` privileges revoked.
- KYC events cannot be updated or deleted.
- Applicant responses never return provider names or case references.
- Case, event, audit, and merchant-badge changes commit in one optimistic transaction.
- Arbitrary review notes and raw provider payloads are not persisted.
- A control-plane approval is not, by itself, a legal assertion that SubScript is a regulated KYC provider.
