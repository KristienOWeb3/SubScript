import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction, requestIp } from "@/lib/admin/audit";
import {
    isAdminTransitionAllowed,
    kindForAccountRole,
    validateAdminDecision,
    validateReasonForStatus,
    isKycStatus,
    type KycStatus,
} from "@/lib/kyc";

/* KYC review for the admin console.
 *
 * WHY THIS EXISTS ALONGSIDE /api/admin/kyc. That route authenticates with an ADMIN_API_KEY bearer
 * header, which carries no identity — it cannot say *which* admin acted, so it cannot gate an
 * override on root membership or attribute one in the audit log. It stays as-is for whatever ops
 * tooling holds that key. This route is the console's, on the wallet session, and follows the
 * precedent set by admin/receipts/invite: a separate route rather than an `|| isAdmin` branch
 * bolted onto the existing one.
 *
 * THE OVERRIDE. api/admin/kyc refuses to let provider="manual" reach APPROVED in production, and
 * ADMIN_TRANSITIONS makes REJECTED/EXPIRED/REVOKED/NEEDS_INPUT terminal for admins. `force-approve`
 * deliberately bypasses both. That is a compliance guard being switched off by hand, so it costs:
 * root admin only, a reason of substance, and a typed confirmation string. Delegated admins can
 * review all day but cannot force. Every force writes three rows — admin_audit_log (who, from
 * where, why), kyc_verification_events (the status trail the applicant record owns), and
 * audit_events (the domain log the rest of KYC writes to) — because one of those three is what
 * someone will actually be looking at later, and we don't get to choose which.
 *
 * Records created here carry provider="manual_admin", permanently separating an admin-asserted
 * verification from a provider-backed one. Do not reuse the plain "manual" provider for these.
 */

const FORCE_CONFIRMATION = "FORCE APPROVE";
const MIN_REASON_LENGTH = 10;
const MANUAL_PROVIDER = "manual_admin";
const DEFAULT_APPROVAL_MONTHS = 12;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

class KycReviewError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

function cleanReason(value: unknown): string {
    if (typeof value !== "string") {
        throw new KycReviewError(`A reason of at least ${MIN_REASON_LENGTH} characters is required`, 400);
    }
    const reason = value.trim();
    if (reason.length < MIN_REASON_LENGTH) {
        throw new KycReviewError(`A reason of at least ${MIN_REASON_LENGTH} characters is required`, 400);
    }
    if (reason.length > 500) {
        throw new KycReviewError("Reason must be 500 characters or fewer", 400);
    }
    return reason;
}

function monthsFromNow(months: number): Date {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date;
}

function parseExpiry(value: unknown, fallback: Date): Date {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") throw new KycReviewError("expiresAt must be an ISO timestamp", 400);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new KycReviewError("expiresAt must be an ISO timestamp", 400);
    if (parsed.getTime() <= Date.now()) {
        throw new KycReviewError("expiresAt must be in the future", 400);
    }
    return parsed;
}

function serialize(row: {
    id: string;
    walletAddress: string;
    accountRole: string;
    kind: string;
    countryCode: string;
    provider: string;
    providerCaseId: string | null;
    requestedLevel: string;
    status: string;
    reasonCode: string | null;
    revision: number;
    submittedAt: Date | null;
    decidedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        ...row,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        /* Surfaced so the console can label admin-asserted records without re-deriving the rule. */
        adminAsserted: row.provider === MANUAL_PROVIDER,
    };
}

const LIST_SELECT = {
    id: true,
    walletAddress: true,
    accountRole: true,
    kind: true,
    countryCode: true,
    provider: true,
    providerCaseId: true,
    requestedLevel: true,
    status: true,
    reasonCode: true,
    revision: true,
    submittedAt: true,
    decidedAt: true,
    expiresAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const params = new URL(request.url).searchParams;

        const rawStatus = params.get("status");
        if (rawStatus !== null && rawStatus !== "all" && !isKycStatus(rawStatus)) {
            return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
        }

        const rawLimit = params.get("limit");
        const limit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return NextResponse.json({ error: "limit must be an integer from 1 to 100" }, { status: 400 });
        }

        const search = (params.get("search") || "").trim().toLowerCase();

        const [rows, statusCounts] = await Promise.all([
            prisma.kycVerification.findMany({
                where: {
                    ...(rawStatus && rawStatus !== "all" ? { status: rawStatus } : {}),
                    ...(search ? { walletAddress: { contains: search } } : {}),
                },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: LIST_SELECT,
            }),
            prisma.kycVerification.groupBy({ by: ["status"], _count: { _all: true } }),
        ]);

        const counts: Record<string, number> = {};
        for (const row of statusCounts) counts[row.status] = row._count._all;

        return NextResponse.json({
            verifications: rows.map(serialize),
            counts,
            pendingCount: (counts.PENDING || 0) + (counts.IN_REVIEW || 0),
            /* The console hides force-approve entirely for delegated admins. The server re-checks
               it below regardless — this only keeps a control they cannot use off their screen. */
            viewerIsRoot: auth.admin.isRoot,
            generatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("[admin/kyc/review] list failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to load verifications" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const action = (body as any).action;
        if (action === "decide") return await handleDecide(request, auth.admin, body as any);
        if (action === "force-approve") return await handleForceApprove(request, auth.admin, body as any);
        if (action === "create-manual") return await handleCreateManual(request, auth.admin, body as any);

        return NextResponse.json(
            { error: "action must be one of: decide, force-approve, create-manual" },
            { status: 400 },
        );
    } catch (error) {
        if (error instanceof KycReviewError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if ((error as { code?: string })?.code === "P2002") {
            return NextResponse.json(
                { error: "That provider case reference is already assigned to another verification" },
                { status: 409 },
            );
        }
        if ((error as { code?: string })?.code === "P2003") {
            return NextResponse.json(
                { error: "That wallet has no account role yet. The user must finish signup first." },
                { status: 409 },
            );
        }
        console.error("[admin/kyc/review] mutation failed:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

type Admin = { wallet: string; isRoot: boolean };

/**
 * Ordinary review. Same rules as the API-key route — ADMIN_TRANSITIONS is respected, approval
 * still needs a provider case id and a future expiry — but attributed to the acting wallet.
 */
async function handleDecide(request: Request, admin: Admin, body: Record<string, unknown>) {
    const payload = validateAdminDecision({
        verificationId: body.verificationId,
        status: body.status,
        ...(body.reasonCode !== undefined ? { reasonCode: body.reasonCode } : {}),
        ...(body.providerCaseId !== undefined ? { providerCaseId: body.providerCaseId } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    });
    if (!payload.ok) throw new KycReviewError(payload.error, 400);

    const result = await applyDecision({
        verificationId: payload.data.verificationId,
        toStatus: payload.data.status,
        reasonCode: payload.data.reasonCode,
        providerCaseId: payload.data.providerCaseId,
        expiresAt: payload.data.expiresAt,
        actor: admin.wallet,
        forced: false,
        ip: requestIp(request),
    });

    await recordAdminAction({
        actor: admin.wallet,
        action: "KYC_DECISION",
        target: result.walletAddress,
        detail: { from: result.fromStatus, to: result.status, reasonCode: result.reasonCode },
        request,
    });

    return NextResponse.json({ success: true, verification: serialize(result) });
}

/**
 * The production override. Bypasses ADMIN_TRANSITIONS and the manual-provider approval block, so
 * it can lift a REJECTED or EXPIRED applicant straight to APPROVED.
 */
async function handleForceApprove(request: Request, admin: Admin, body: Record<string, unknown>) {
    if (!admin.isRoot) {
        throw new KycReviewError(
            "Only root admins (ADMIN_WALLET_ADDRESSES) can force-approve a verification.",
            403,
        );
    }
    if (body.confirm !== FORCE_CONFIRMATION) {
        throw new KycReviewError(`Type "${FORCE_CONFIRMATION}" to confirm this override`, 400);
    }
    const reason = cleanReason(body.reason);

    if (typeof body.verificationId !== "string" || !body.verificationId) {
        throw new KycReviewError("verificationId is required", 400);
    }

    const expiresAt = parseExpiry(body.expiresAt, monthsFromNow(DEFAULT_APPROVAL_MONTHS));

    const result = await applyDecision({
        verificationId: body.verificationId,
        toStatus: "APPROVED",
        reasonCode: null,
        /* Approval requires a unique case reference. A forced approval has no provider case to
           point at, so we mint one that says exactly what it is. */
        providerCaseId:
            typeof body.providerCaseId === "string" && body.providerCaseId.trim()
                ? body.providerCaseId.trim()
                : undefined,
        expiresAt,
        actor: admin.wallet,
        forced: true,
        reason,
        ip: requestIp(request),
    });

    await recordAdminAction({
        actor: admin.wallet,
        action: "KYC_FORCE_APPROVE",
        target: result.walletAddress,
        detail: {
            from: result.fromStatus,
            provider: result.provider,
            expiresAt: result.expiresAt?.toISOString() ?? null,
            reason,
        },
        request,
    });

    return NextResponse.json({ success: true, verification: serialize(result) });
}

/** Open a record for a wallet that never applied, so it can then be reviewed or force-approved. */
async function handleCreateManual(request: Request, admin: Admin, body: Record<string, unknown>) {
    if (!admin.isRoot) {
        throw new KycReviewError(
            "Only root admins (ADMIN_WALLET_ADDRESSES) can open a manual verification.",
            403,
        );
    }
    if (typeof body.walletAddress !== "string" || !WALLET_RE.test(body.walletAddress.trim())) {
        throw new KycReviewError("walletAddress must be a 0x-prefixed 40-character address", 400);
    }
    const reason = cleanReason(body.reason);
    const walletAddress = body.walletAddress.trim().toLowerCase();

    const countryCode =
        typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode.trim())
            ? body.countryCode.trim().toUpperCase()
            : null;
    if (!countryCode) throw new KycReviewError("countryCode must be a two-letter country code", 400);

    const requestedLevel = body.requestedLevel === "ENHANCED" ? "ENHANCED" : "STANDARD";

    const account = await prisma.accountRole.findUnique({ where: { address: walletAddress } });
    if (!account) {
        throw new KycReviewError(
            "That wallet has no account role yet. The user must finish signup first.",
            409,
        );
    }
    const kind = kindForAccountRole(account.role);
    if (!kind) throw new KycReviewError(`Unrecognised account role "${account.role}"`, 409);

    const existing = await prisma.kycVerification.findUnique({ where: { walletAddress } });
    if (existing) {
        throw new KycReviewError(
            "That wallet already has a verification record. Use the review controls instead.",
            409,
        );
    }

    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
        const row = await tx.kycVerification.create({
            data: {
                walletAddress,
                accountRole: account.role,
                kind,
                countryCode,
                provider: MANUAL_PROVIDER,
                requestedLevel,
                status: "PENDING",
                /* The applicant did not consent — an admin opened this on their behalf. Recorded
                   honestly rather than left null (the column is NOT NULL) so the provenance is
                   readable straight off the row, not only from the audit log. */
                consentVersion: "admin-manual/v1",
                consentedAt: now,
                submittedAt: now,
            },
            select: LIST_SELECT,
        });

        await tx.kycVerificationEvent.create({
            data: {
                verificationId: row.id,
                actorType: "ADMIN",
                actorId: admin.wallet,
                fromStatus: null,
                toStatus: "PENDING",
            },
        });
        await tx.auditEvent.create({
            data: {
                actor: admin.wallet,
                action: "KYC_MANUAL_RECORD_CREATED",
                resourceType: "KYC_VERIFICATION",
                resourceId: row.id,
                ipAddress: requestIp(request),
                metadata: { walletAddress, accountRole: account.role, provider: MANUAL_PROVIDER, reason },
            },
        });
        return row;
    });

    await recordAdminAction({
        actor: admin.wallet,
        action: "KYC_MANUAL_CREATE",
        target: walletAddress,
        detail: { accountRole: account.role, countryCode, requestedLevel, reason },
        request,
    });

    return NextResponse.json({ success: true, verification: serialize(created) });
}

/**
 * Shared write path for both decide and force-approve.
 *
 * The updateMany guarded on {id, status, revision} is the existing optimistic-concurrency scheme:
 * two admins deciding the same case at once means the second one's write matches zero rows and is
 * reported as a conflict rather than silently overwriting the first.
 */
async function applyDecision(params: {
    verificationId: string;
    toStatus: KycStatus;
    reasonCode: string | null;
    providerCaseId?: string;
    expiresAt?: Date;
    actor: string;
    forced: boolean;
    reason?: string;
    ip: string | null;
}) {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.kycVerification.findUnique({
            where: { id: params.verificationId },
        });
        if (!existing) throw new KycReviewError("Verification not found", 404);

        const fromStatus = existing.status as KycStatus;

        if (params.forced) {
            if (fromStatus === "APPROVED") {
                throw new KycReviewError("This verification is already approved", 409);
            }
        } else if (!isAdminTransitionAllowed(fromStatus, params.toStatus)) {
            throw new KycReviewError(
                `Transition from ${fromStatus} to ${params.toStatus} is not allowed`,
                409,
            );
        }

        const reasonCheck = validateReasonForStatus(params.toStatus, params.reasonCode ?? undefined);
        if (!reasonCheck.ok) throw new KycReviewError(reasonCheck.error, 400);

        const now = new Date();
        const providerCaseId =
            params.providerCaseId
            ?? existing.providerCaseId
            ?? (params.forced ? `${MANUAL_PROVIDER}:${existing.walletAddress}:${now.getTime()}` : null);
        const expiresAt = params.expiresAt ?? existing.expiresAt;

        if (params.toStatus === "APPROVED") {
            if (!providerCaseId) {
                throw new KycReviewError("A providerCaseId is required before approval", 400);
            }
            if (!expiresAt || expiresAt <= now) {
                throw new KycReviewError("A future expiresAt timestamp is required before approval", 400);
            }
            /* The production manual-approval block, preserved for the non-forced path. Bypassing
               it is exactly what force-approve is for, and that path is root-only and audited. */
            if (
                !params.forced
                && process.env.NODE_ENV === "production"
                && ["manual", MANUAL_PROVIDER].includes(existing.provider.toLowerCase())
            ) {
                throw new KycReviewError(
                    "Manual verification cannot grant production approval. Use force-approve (root admin).",
                    503,
                );
            }
        }

        const isDecision = ["APPROVED", "REJECTED", "EXPIRED", "REVOKED"].includes(params.toStatus);
        const update = await tx.kycVerification.updateMany({
            where: { id: existing.id, status: existing.status, revision: existing.revision },
            data: {
                status: params.toStatus,
                reasonCode: params.reasonCode,
                providerUpdatedAt: now,
                decidedAt: isDecision ? now : null,
                /* Written unconditionally: both are resolved above as params ?? existing ?? minted,
                   so re-writing an unchanged value is a no-op. Comparing against `existing` to skip
                   the write would compare Date objects by reference and never match anyway. */
                providerCaseId,
                expiresAt,
                revision: { increment: 1 },
            },
        });
        if (update.count !== 1) {
            throw new KycReviewError("Verification changed while the request was processing", 409);
        }

        const updated = await tx.kycVerification.findUniqueOrThrow({
            where: { id: existing.id },
            select: LIST_SELECT,
        });

        await tx.kycVerificationEvent.create({
            data: {
                verificationId: updated.id,
                actorType: "ADMIN",
                /* The API-key route writes the constant "admin" here because a bearer key has no
                   identity. A wallet session does, so record it. */
                actorId: params.actor,
                fromStatus,
                toStatus: params.toStatus,
                reasonCode: params.reasonCode,
            },
        });
        await tx.auditEvent.create({
            data: {
                actor: params.actor,
                action: params.forced ? "KYC_FORCE_APPROVED" : "KYC_STATUS_CHANGED",
                resourceType: "KYC_VERIFICATION",
                resourceId: updated.id,
                ipAddress: params.ip,
                metadata: {
                    fromStatus,
                    toStatus: params.toStatus,
                    reasonCode: params.reasonCode,
                    revision: updated.revision,
                    ...(params.forced ? { forced: true, reason: params.reason } : {}),
                },
            },
        });

        /* Scoped to ENTERPRISE. The API-key route upserts this unconditionally, which mints a
           merchants row — flagged verified — for an individual who merely passed identity checks.
           That badge is what payers are shown at checkout, so it must only follow a BUSINESS
           verification. Individuals get their KYC status and nothing else. */
        if (updated.accountRole === "ENTERPRISE") {
            await tx.merchant.upsert({
                where: { walletAddress: updated.walletAddress },
                update: { verified: params.toStatus === "APPROVED" },
                create: { walletAddress: updated.walletAddress, verified: params.toStatus === "APPROVED" },
            });
        }

        return { ...updated, fromStatus };
    });
}
