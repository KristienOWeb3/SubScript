import { createHash, timingSafeEqual } from "node:crypto";

export const KYC_STATUSES = [
    "PENDING",
    "IN_REVIEW",
    "NEEDS_INPUT",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "REVOKED",
] as const;

export type KycStatus = typeof KYC_STATUSES[number];
export type KycKind = "INDIVIDUAL" | "BUSINESS";
export type KycAccountRole = "USER" | "ENTERPRISE";
export type KycRequestedLevel = "STANDARD" | "ENHANCED";

export const KYC_REASON_LABELS = {
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
} as const;

export type KycReasonCode = keyof typeof KYC_REASON_LABELS;

const APPLICANT_RESUBMISSION_STATUSES = new Set<KycStatus>([
    "NEEDS_INPUT",
    "REJECTED",
    "EXPIRED",
    "REVOKED",
]);

const ADMIN_TRANSITIONS: Record<KycStatus, ReadonlySet<KycStatus>> = {
    PENDING: new Set(["IN_REVIEW", "NEEDS_INPUT", "APPROVED", "REJECTED"]),
    IN_REVIEW: new Set(["NEEDS_INPUT", "APPROVED", "REJECTED"]),
    NEEDS_INPUT: new Set(),
    APPROVED: new Set(["EXPIRED", "REVOKED"]),
    REJECTED: new Set(),
    EXPIRED: new Set(),
    REVOKED: new Set(),
};

const REASONS_BY_TARGET: Record<KycStatus, ReadonlySet<KycReasonCode>> = {
    PENDING: new Set(),
    IN_REVIEW: new Set(),
    NEEDS_INPUT: new Set([
        "ADDITIONAL_INFORMATION_REQUIRED",
        "DOCUMENT_EXPIRED",
        "DOCUMENT_UNREADABLE",
        "IDENTITY_MISMATCH",
        "BUSINESS_DETAILS_MISMATCH",
    ]),
    APPROVED: new Set(),
    REJECTED: new Set([
        "IDENTITY_MISMATCH",
        "BUSINESS_DETAILS_MISMATCH",
        "UNSUPPORTED_JURISDICTION",
        "PROVIDER_REJECTED",
        "COMPLIANCE_REVIEW_FAILED",
    ]),
    EXPIRED: new Set(["APPROVAL_EXPIRED"]),
    REVOKED: new Set(["APPROVAL_REVOKED", "COMPLIANCE_REVIEW_FAILED"]),
};

const APPLICANT_FIELDS = new Set(["countryCode", "consent"]);
const ADMIN_DECISION_FIELDS = new Set([
    "verificationId",
    "status",
    "reasonCode",
    "providerCaseId",
    "expiresAt",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidationResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
    return Object.keys(value).every((key) => allowed.has(key));
}

export function isKycStatus(value: unknown): value is KycStatus {
    return typeof value === "string" && (KYC_STATUSES as readonly string[]).includes(value);
}

export function kindForAccountRole(role: unknown): KycKind | null {
    if (role === "USER") return "INDIVIDUAL";
    if (role === "ENTERPRISE") return "BUSINESS";
    return null;
}

export function canApplicantResubmit(status: KycStatus): boolean {
    return APPLICANT_RESUBMISSION_STATUSES.has(status);
}

export function isAdminTransitionAllowed(from: KycStatus, to: KycStatus): boolean {
    return ADMIN_TRANSITIONS[from].has(to);
}

export function validateReasonForStatus(
    status: KycStatus,
    reasonCode: unknown
): ValidationResult<KycReasonCode | null> {
    const allowed = REASONS_BY_TARGET[status];
    if (allowed.size === 0) {
        return reasonCode === undefined || reasonCode === null || reasonCode === ""
            ? { ok: true, data: null }
            : { ok: false, error: `reasonCode is not allowed for ${status}` };
    }

    if (typeof reasonCode !== "string" || !allowed.has(reasonCode as KycReasonCode)) {
        return { ok: false, error: `A valid reasonCode is required for ${status}` };
    }
    return { ok: true, data: reasonCode as KycReasonCode };
}

export function parseSupportedCountryCodes(value: string | undefined): ValidationResult<ReadonlySet<string>> {
    const countries = (value || "")
        .split(",")
        .map((country) => country.trim().toUpperCase())
        .filter(Boolean);
    if (countries.length === 0 || countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
        return {
            ok: false,
            error: "KYC_SUPPORTED_COUNTRIES must contain comma-separated two-letter country codes",
        };
    }
    return { ok: true, data: new Set(countries) };
}

export function validateApplicantPayload(
    input: unknown,
    supportedCountries: ReadonlySet<string> = new Set(["NG"])
): ValidationResult<{
    countryCode: string;
    consent: true;
}> {
    if (!isRecord(input) || !hasOnlyFields(input, APPLICANT_FIELDS)) {
        return { ok: false, error: "Invalid request payload" };
    }
    if (input.consent !== true) {
        return { ok: false, error: "Explicit verification consent is required" };
    }
    if (typeof input.countryCode !== "string" || !/^[A-Za-z]{2}$/.test(input.countryCode)) {
        return { ok: false, error: "countryCode must be a two-letter country code" };
    }
    const countryCode = input.countryCode.toUpperCase();
    if (!supportedCountries.has(countryCode)) {
        return { ok: false, error: "Verification is not available for this country" };
    }
    return {
        ok: true,
        data: {
            countryCode,
            consent: true,
        },
    };
}

export function validateAdminDecision(input: unknown): ValidationResult<{
    verificationId: string;
    status: KycStatus;
    reasonCode: KycReasonCode | null;
    providerCaseId?: string;
    expiresAt?: Date;
}> {
    if (!isRecord(input) || !hasOnlyFields(input, ADMIN_DECISION_FIELDS)) {
        return { ok: false, error: "Invalid request payload" };
    }
    if (typeof input.verificationId !== "string" || !UUID_RE.test(input.verificationId)) {
        return { ok: false, error: "verificationId must be a valid UUID" };
    }
    if (!isKycStatus(input.status) || input.status === "PENDING") {
        return { ok: false, error: "Invalid target status" };
    }

    const reason = validateReasonForStatus(input.status, input.reasonCode);
    if (!reason.ok) return reason;

    let providerCaseId: string | undefined;
    if (input.providerCaseId !== undefined) {
        if (
            typeof input.providerCaseId !== "string"
            || input.providerCaseId.trim().length === 0
            || input.providerCaseId.trim().length > 200
        ) {
            return { ok: false, error: "providerCaseId must be 1-200 characters" };
        }
        providerCaseId = input.providerCaseId.trim();
    }

    let expiresAt: Date | undefined;
    if (input.expiresAt !== undefined) {
        if (typeof input.expiresAt !== "string") {
            return { ok: false, error: "expiresAt must be an ISO timestamp" };
        }
        expiresAt = new Date(input.expiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== input.expiresAt) {
            return { ok: false, error: "expiresAt must be an ISO timestamp" };
        }
    }

    return {
        ok: true,
        data: {
            verificationId: input.verificationId,
            status: input.status,
            reasonCode: reason.data,
            ...(providerCaseId ? { providerCaseId } : {}),
            ...(expiresAt ? { expiresAt } : {}),
        },
    };
}

export function parseAdminListParams(searchParams: URLSearchParams): ValidationResult<{
    status?: KycStatus;
    limit: number;
}> {
    const rawStatus = searchParams.get("status");
    if (rawStatus !== null && !isKycStatus(rawStatus)) {
        return { ok: false, error: "Invalid status filter" };
    }

    const rawLimit = searchParams.get("limit");
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
        return { ok: false, error: "limit must be an integer from 1 to 100" };
    }
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return { ok: false, error: "limit must be an integer from 1 to 100" };
    }

    return {
        ok: true,
        data: {
            ...(rawStatus ? { status: rawStatus as KycStatus } : {}),
            limit,
        },
    };
}

function digestAdminKey(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
}

export function verifyAdminApiKey(headers: Headers, expectedKey = process.env.ADMIN_API_KEY): boolean {
    const authorization = headers.get("authorization") || "";
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    const providedKey = (headers.get("x-admin-api-key") || bearerMatch?.[1] || "").trim();
    const configuredKey = expectedKey || "";
    const keysMatch = timingSafeEqual(digestAdminKey(providedKey), digestAdminKey(configuredKey));
    return configuredKey.length >= 32 && providedKey.length > 0 && keysMatch;
}

export type PublicKycRecord = {
    id: string;
    kind: KycKind;
    countryCode: string;
    requestedLevel: KycRequestedLevel;
    status: KycStatus;
    reasonCode: string | null;
    revision: number;
    consentedAt: Date;
    submittedAt: Date | null;
    providerUpdatedAt: Date | null;
    decidedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export function toPublicKycDto(record: PublicKycRecord) {
    const reasonLabel = record.reasonCode
        ? KYC_REASON_LABELS[record.reasonCode as KycReasonCode] || null
        : null;

    return {
        id: record.id,
        kind: record.kind,
        countryCode: record.countryCode,
        requestedLevel: record.requestedLevel,
        status: record.status,
        reasonCode: record.reasonCode,
        reasonLabel,
        revision: record.revision,
        consentedAt: record.consentedAt,
        submittedAt: record.submittedAt,
        providerUpdatedAt: record.providerUpdatedAt,
        decidedAt: record.decidedAt,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        canResubmit: canApplicantResubmit(record.status),
    };
}
