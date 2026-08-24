import { NextResponse } from "next/server";
import {
    isAdminTransitionAllowed,
    parseAdminListParams,
    validateAdminDecision,
    type KycStatus,
} from "@/lib/kyc";
import { prisma } from "@/lib/prisma";
import { jsonOk } from "@/lib/http/json";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction, requestIp } from "@/lib/admin/audit";
import { runAdminQueriesSequentially } from "@/lib/admin/db";

/* Responses go out through jsonOk, not NextResponse.json, because both handlers echo whole
   `kyc_verifications` rows rather than a named projection (unlike api/admin/kyc/review, which
   has serialize()). No column on that model is BigInt today, so nothing is broken — but a
   whole-row echo is precisely the shape that turned a working merchant-verify write into a
   "Do not know how to serialize a BigInt" 500 the moment a money column landed on `merchants`.
   jsonOk makes that class of regression impossible here instead of relying on nobody adding a
   BigInt column to this table. */

class KycAdminRouteError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

export async function GET(request: Request) {
    const auth = await requireScope(request, "compliance");
    if (!auth.ok) return auth.response;

    try {
        const params = parseAdminListParams(new URL(request.url).searchParams);
        if (!params.ok) {
            return NextResponse.json({ error: params.error }, { status: 400 });
        }

        const [verifications] = await runAdminQueriesSequentially([
            () => prisma.kycVerification.findMany({
                where: params.data.status ? { status: params.data.status } : undefined,
                orderBy: { createdAt: "desc" },
                take: params.data.limit,
            }),
        ]);

        return jsonOk({ success: true, verifications });
    } catch (error) {
        console.error("Failed to list KYC verifications:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireScope(request, "compliance");
    if (!auth.ok) return auth.response;

    try {
        const payload = validateAdminDecision(await request.json().catch(() => null));
        if (!payload.ok) {
            return NextResponse.json({ error: payload.error }, { status: 400 });
        }

        const verification = await prisma.$transaction(async (tx) => {
            const existing = await tx.kycVerification.findUnique({
                where: { id: payload.data.verificationId },
            });
            if (!existing) {
                throw new KycAdminRouteError("Verification not found", 404);
            }

            const fromStatus = existing.status as KycStatus;
            if (!isAdminTransitionAllowed(fromStatus, payload.data.status)) {
                throw new KycAdminRouteError(
                    `Transition from ${fromStatus} to ${payload.data.status} is not allowed`,
                    409
                );
            }

            const now = new Date();
            const effectiveProviderCaseId = payload.data.providerCaseId ?? existing.providerCaseId;
            const effectiveExpiresAt = payload.data.expiresAt ?? existing.expiresAt;
            if (payload.data.status === "APPROVED") {
                if (!effectiveProviderCaseId) {
                    throw new KycAdminRouteError(
                        "A providerCaseId is required before approval",
                        400
                    );
                }
                if (!effectiveExpiresAt || effectiveExpiresAt <= now) {
                    throw new KycAdminRouteError(
                        "A future expiresAt timestamp is required before approval",
                        400
                    );
                }
                if (
                    process.env.NODE_ENV === "production"
                    && existing.provider.toLowerCase() === "manual"
                ) {
                    throw new KycAdminRouteError(
                        "Manual verification cannot grant production approval",
                        503
                    );
                }
            }
            const isDecision = ["APPROVED", "REJECTED", "EXPIRED", "REVOKED"].includes(
                payload.data.status
            );
            const update = await tx.kycVerification.updateMany({
                where: {
                    id: existing.id,
                    status: existing.status,
                    revision: existing.revision,
                },
                data: {
                    status: payload.data.status,
                    reasonCode: payload.data.reasonCode,
                    providerUpdatedAt: now,
                    decidedAt: isDecision ? now : null,
                    ...(payload.data.providerCaseId !== undefined
                        ? { providerCaseId: payload.data.providerCaseId }
                        : {}),
                    ...(payload.data.expiresAt !== undefined
                        ? { expiresAt: payload.data.expiresAt }
                        : {}),
                    revision: { increment: 1 },
                },
            });
            if (update.count !== 1) {
                throw new KycAdminRouteError(
                    "Verification changed while the request was processing",
                    409
                );
            }

            const updated = await tx.kycVerification.findUniqueOrThrow({
                where: { id: existing.id },
            });
            await tx.kycVerificationEvent.create({
                data: {
                    verificationId: updated.id,
                    actorType: "ADMIN",
                    actorId: auth.admin.wallet,
                    fromStatus,
                    toStatus: payload.data.status,
                    reasonCode: payload.data.reasonCode,
                },
            });
            await tx.auditEvent.create({
                data: {
                    actor: auth.admin.wallet,
                    action: "KYC_STATUS_CHANGED",
                    resourceType: "KYC_VERIFICATION",
                    resourceId: updated.id,
                    metadata: {
                    ipAddress: requestIp(request),
                        fromStatus,
                        toStatus: payload.data.status,
                        reasonCode: payload.data.reasonCode,
                        revision: updated.revision,
                    },
                },
            });
            if (updated.accountRole === "ENTERPRISE") {
                await tx.merchant.upsert({
                    where: { walletAddress: updated.walletAddress },
                    update: { verified: payload.data.status === "APPROVED" },
                    create: {
                        walletAddress: updated.walletAddress,
                        verified: payload.data.status === "APPROVED",
                    },
                });
            }
            return updated;
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "KYC_DECISION",
            target: verification.walletAddress,
            detail: {
                to: payload.data.status,
                reasonCode: payload.data.reasonCode,
            },
            request,
        });

        return jsonOk({ success: true, verification });
    } catch (error) {
        if (error instanceof KycAdminRouteError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if ((error as { code?: string })?.code === "P2002") {
            return NextResponse.json(
                { error: "The provider case reference is already assigned" },
                { status: 409 }
            );
        }
        console.error("Failed to update KYC verification:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
