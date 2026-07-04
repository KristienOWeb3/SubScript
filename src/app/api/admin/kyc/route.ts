import { NextResponse } from "next/server";
import {
    isAdminTransitionAllowed,
    parseAdminListParams,
    validateAdminDecision,
    verifyAdminApiKey,
    type KycStatus,
} from "@/lib/kyc";
import { prisma } from "@/lib/prisma";

class KycAdminRouteError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

export async function GET(request: Request) {
    if (!verifyAdminApiKey(request.headers)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const params = parseAdminListParams(new URL(request.url).searchParams);
        if (!params.ok) {
            return NextResponse.json({ error: params.error }, { status: 400 });
        }

        const verifications = await prisma.kycVerification.findMany({
            where: params.data.status ? { status: params.data.status } : undefined,
            orderBy: { createdAt: "desc" },
            take: params.data.limit,
        });

        return NextResponse.json({ success: true, verifications });
    } catch (error) {
        console.error("Failed to list KYC verifications:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    if (!verifyAdminApiKey(request.headers)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
                    actorId: "admin",
                    fromStatus,
                    toStatus: payload.data.status,
                    reasonCode: payload.data.reasonCode,
                },
            });
            await tx.auditEvent.create({
                data: {
                    actor: "admin",
                    action: "KYC_STATUS_CHANGED",
                    resourceType: "KYC_VERIFICATION",
                    resourceId: updated.id,
                    metadata: {
                        fromStatus,
                        toStatus: payload.data.status,
                        reasonCode: payload.data.reasonCode,
                        revision: updated.revision,
                    },
                },
            });
            if (updated.kind === "BUSINESS") {
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

        return NextResponse.json({ success: true, verification });
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
