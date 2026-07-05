import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const domainSource = source("src/lib/kyc/index.ts");
const domainJavascript = ts.transpileModule(domainSource, {
    compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
    },
}).outputText;
const kyc = await import(
    `data:text/javascript;base64,${Buffer.from(domainJavascript).toString("base64")}`
);

const statuses = [
    "PENDING",
    "IN_REVIEW",
    "NEEDS_INPUT",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "REVOKED",
];

const reasonsByTarget = {
    PENDING: [],
    IN_REVIEW: [],
    NEEDS_INPUT: [
        "ADDITIONAL_INFORMATION_REQUIRED",
        "DOCUMENT_EXPIRED",
        "DOCUMENT_UNREADABLE",
        "IDENTITY_MISMATCH",
        "BUSINESS_DETAILS_MISMATCH",
    ],
    APPROVED: [],
    REJECTED: [
        "IDENTITY_MISMATCH",
        "BUSINESS_DETAILS_MISMATCH",
        "UNSUPPORTED_JURISDICTION",
        "PROVIDER_REJECTED",
        "COMPLIANCE_REVIEW_FAILED",
    ],
    EXPIRED: ["APPROVAL_EXPIRED"],
    REVOKED: ["APPROVAL_REVOKED", "COMPLIANCE_REVIEW_FAILED"],
};

test("applicant input is minimal, consented, and country-normalized", () => {
    assert.deepEqual(kyc.validateApplicantPayload({ countryCode: "ng", consent: true }), {
        ok: true,
        data: { countryCode: "NG", consent: true },
    });
    assert.equal(kyc.validateApplicantPayload({ countryCode: "NGA", consent: true }).ok, false);
    assert.equal(kyc.validateApplicantPayload({ countryCode: "NG", consent: false }).ok, false);
    assert.equal(
        kyc.validateApplicantPayload({
            countryCode: "NG",
            consent: true,
            legalName: "Must stay with provider",
        }).ok,
        false
    );
});

test("authoritative account roles map to their only valid KYC kind", () => {
    assert.equal(kyc.kindForAccountRole("USER"), "INDIVIDUAL");
    assert.equal(kyc.kindForAccountRole("ENTERPRISE"), "BUSINESS");
    assert.equal(kyc.kindForAccountRole("ADMIN"), null);
    assert.equal(kyc.kindForAccountRole(undefined), null);
});

test("only terminal/remediation applicant states can resubmit", () => {
    const allowed = new Set(["NEEDS_INPUT", "REJECTED", "EXPIRED", "REVOKED"]);
    for (const status of statuses) {
        assert.equal(kyc.canApplicantResubmit(status), allowed.has(status), status);
    }
});

test("admin transition matrix allows exactly the specified edges", () => {
    const allowed = new Set([
        "PENDING:IN_REVIEW",
        "PENDING:NEEDS_INPUT",
        "PENDING:APPROVED",
        "PENDING:REJECTED",
        "IN_REVIEW:NEEDS_INPUT",
        "IN_REVIEW:APPROVED",
        "IN_REVIEW:REJECTED",
        "APPROVED:EXPIRED",
        "APPROVED:REVOKED",
    ]);

    for (const from of statuses) {
        for (const to of statuses) {
            assert.equal(
                kyc.isAdminTransitionAllowed(from, to),
                allowed.has(`${from}:${to}`),
                `${from} -> ${to}`
            );
        }
    }
});

test("every status accepts only its target-specific controlled reason codes", () => {
    const allReasons = Object.keys(kyc.KYC_REASON_LABELS);
    for (const status of statuses) {
        const allowed = new Set(reasonsByTarget[status]);
        if (allowed.size === 0) {
            assert.deepEqual(kyc.validateReasonForStatus(status, null), {
                ok: true,
                data: null,
            });
        } else {
            assert.equal(kyc.validateReasonForStatus(status, null).ok, false, status);
        }
        for (const reason of allReasons) {
            assert.equal(
                kyc.validateReasonForStatus(status, reason).ok,
                allowed.has(reason),
                `${status} / ${reason}`
            );
        }
    }
});

test("reason-code labels are stable, non-sensitive applicant guidance", () => {
    assert.deepEqual(kyc.KYC_REASON_LABELS, {
        ADDITIONAL_INFORMATION_REQUIRED: "The provider needs more information.",
        DOCUMENT_EXPIRED: "A submitted document has expired.",
        DOCUMENT_UNREADABLE: "A submitted document could not be read.",
        IDENTITY_MISMATCH: "The submitted identity details did not match.",
        BUSINESS_DETAILS_MISMATCH: "The submitted business details did not match.",
        UNSUPPORTED_JURISDICTION: "Verification is not available in this jurisdiction.",
        PROVIDER_REJECTED: "The verification provider could not approve this application.",
        COMPLIANCE_REVIEW_FAILED: "The application did not pass compliance review.",
        APPROVAL_EXPIRED: "The prior approval has expired.",
        APPROVAL_REVOKED: "The prior approval was revoked.",
    });
});

test("admin decisions reject free text and validate opaque references and timestamps", () => {
    const valid = kyc.validateAdminDecision({
        verificationId: "123e4567-e89b-42d3-a456-426614174000",
        status: "REJECTED",
        reasonCode: "PROVIDER_REJECTED",
        providerCaseId: "provider-case-42",
        expiresAt: "2027-01-01T00:00:00.000Z",
    });
    assert.equal(valid.ok, true);

    assert.equal(kyc.validateAdminDecision({
        verificationId: "123e4567-e89b-42d3-a456-426614174000",
        status: "REJECTED",
        reasonCode: "Reviewer did not like it",
    }).ok, false);
    assert.equal(kyc.validateAdminDecision({
        verificationId: "123e4567-e89b-42d3-a456-426614174000",
        status: "APPROVED",
        notes: "Sensitive reviewer note",
    }).ok, false);
    assert.equal(kyc.validateAdminDecision({
        verificationId: "not-a-uuid",
        status: "APPROVED",
    }).ok, false);
});

test("admin list filters enforce known statuses and a bounded integer limit", () => {
    assert.deepEqual(kyc.parseAdminListParams(new URLSearchParams()), {
        ok: true,
        data: { limit: 50 },
    });
    assert.deepEqual(
        kyc.parseAdminListParams(new URLSearchParams("status=IN_REVIEW&limit=100")),
        { ok: true, data: { status: "IN_REVIEW", limit: 100 } }
    );
    assert.equal(kyc.parseAdminListParams(new URLSearchParams("status=UNKNOWN")).ok, false);
    assert.equal(kyc.parseAdminListParams(new URLSearchParams("limit=0")).ok, false);
    assert.equal(kyc.parseAdminListParams(new URLSearchParams("limit=1.5")).ok, false);
    assert.equal(kyc.parseAdminListParams(new URLSearchParams("limit=101")).ok, false);
});

test("public DTO redacts provider identifiers and includes controlled reason guidance", () => {
    const now = new Date("2026-07-04T00:00:00.000Z");
    const dto = kyc.toPublicKycDto({
        id: "verification-id",
        walletAddress: "0xprivate",
        accountRole: "USER",
        kind: "INDIVIDUAL",
        countryCode: "NG",
        provider: "licensed-provider",
        providerCaseId: "provider-secret-reference",
        requestedLevel: "STANDARD",
        status: "NEEDS_INPUT",
        reasonCode: "DOCUMENT_UNREADABLE",
        revision: 2,
        consentVersion: "2026-07-04",
        consentedAt: now,
        submittedAt: now,
        providerUpdatedAt: now,
        decidedAt: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
    });

    assert.equal(dto.reasonLabel, "A submitted document could not be read.");
    assert.equal(dto.canResubmit, true);
    assert.equal("provider" in dto, false);
    assert.equal("providerCaseId" in dto, false);
    assert.equal("walletAddress" in dto, false);
    assert.equal("accountRole" in dto, false);
    assert.equal("consentVersion" in dto, false);
});

test("admin key supports bearer and explicit header variants in constant-time helper", () => {
    assert.equal(
        kyc.verifyAdminApiKey(new Headers({ authorization: "Bearer correct-key" }), "correct-key"),
        true
    );
    assert.equal(
        kyc.verifyAdminApiKey(new Headers({ "x-admin-api-key": "correct-key" }), "correct-key"),
        true
    );
    assert.equal(
        kyc.verifyAdminApiKey(new Headers({ authorization: "Bearer wrong-key" }), "correct-key"),
        false
    );
    assert.equal(kyc.verifyAdminApiKey(new Headers(), "correct-key"), false);
    assert.equal(kyc.verifyAdminApiKey(new Headers({ "x-admin-api-key": "anything" }), ""), false);
});

test("migration enforces minimized schema, deny-all RLS, and append-only history", () => {
    const migration = source("supabase/migrations/20260709000000_add_kyc_verification.sql");

    assert.match(migration, /CREATE TABLE public\.kyc_verifications/i);
    assert.match(migration, /REFERENCES public\.account_roles\(address\) ON DELETE RESTRICT/i);
    assert.match(migration, /country_code ~ '\^\[A-Z\]\{2\}\$'/i);
    assert.match(migration, /revision INTEGER NOT NULL DEFAULT 1[\s\S]*CHECK \(revision > 0\)/i);
    assert.match(migration, /kyc_verifications_status_reason_check/i);
    assert.match(migration, /kyc_verifications_review_queue_idx/i);
    assert.match(migration, /kyc_verification_events_verification_created_idx/i);
    assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.kyc_verification_events/i);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
    assert.match(migration, /TO anon, authenticated[\s\S]*USING \(false\)/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.kyc_verifications FROM anon, authenticated/i);
    assert.match(migration, /KYC_LEGACY_VERIFICATION_RESET/);
    assert.match(migration, /UPDATE public\.merchants[\s\S]*SET verified = false/i);
});

test("applicant route derives role and commits case, event, audit, and badge atomically", () => {
    const route = source("src/app/api/kyc/route.ts");

    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /tx\.accountRole\.findUnique/);
    assert.match(route, /kindForAccountRole\(roleRecord\?\.role\)/);
    assert.match(route, /prisma\.\$transaction/);
    assert.match(route, /tx\.kycVerification\.updateMany/);
    assert.match(route, /status:\s*existing\.status[\s\S]*revision:\s*existing\.revision/);
    assert.match(route, /tx\.kycVerificationEvent\.create/g);
    assert.match(route, /tx\.auditEvent\.create/g);
    assert.match(route, /tx\.merchant\.upsert/g);
    assert.match(route, /verified:\s*false/g);
    assert.match(route, /toPublicKycDto/);
    assert.match(route, /searchParams\.set\("reference", verificationId\)/);
    assert.doesNotMatch(route, /searchParams\.set\([^,]+,\s*(?:normalized)?Wallet/);
    assert.doesNotMatch(route, /providerCaseId[\s\S]*NextResponse\.json/);
});

test("admin route authenticates, validates filters, and uses optimistic atomic transitions", () => {
    const route = source("src/app/api/admin/kyc/route.ts");

    assert.match(route, /verifyAdminApiKey\(request\.headers\)/g);
    assert.match(route, /parseAdminListParams/);
    assert.match(route, /validateAdminDecision/);
    assert.match(route, /isAdminTransitionAllowed/);
    assert.match(route, /prisma\.\$transaction/);
    assert.match(route, /tx\.kycVerification\.updateMany/);
    assert.match(route, /status:\s*existing\.status[\s\S]*revision:\s*existing\.revision/);
    assert.match(route, /tx\.kycVerificationEvent\.create/);
    assert.match(route, /tx\.auditEvent\.create/);
    assert.match(route, /verified:\s*payload\.data\.status === "APPROVED"/g);
});

test("legacy merchant verification authority is permanently retired", () => {
    const route = source("src/app/api/admin/merchant-verification/route.ts");

    assert.match(route, /status:\s*410/);
    assert.doesNotMatch(route, /prisma/);
    assert.doesNotMatch(route, /verified\s*[,}]/);
});
