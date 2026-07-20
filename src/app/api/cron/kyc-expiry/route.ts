import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function digest(value: string) {
    return createHash("sha256").update(value, "utf8").digest();
}

function isAuthorized(request: Request) {
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const provided = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));
    return provided.length > 0
        && configured.some((value) => value.length > 0 && timingSafeEqual(digest(provided), digest(value)));
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const now = new Date();
        const candidates = await prisma.kycVerification.findMany({
            where: {
                status: "APPROVED",
                expiresAt: { lte: now },
            },
            select: { id: true },
            orderBy: { expiresAt: "asc" },
            take: 200,
        });

        let expired = 0;
        for (const candidate of candidates) {
            const changed = await prisma.$transaction(async (tx) => {
                const current = await tx.kycVerification.findUnique({
                    where: { id: candidate.id },
                });
                if (
                    !current
                    || current.status !== "APPROVED"
                    || !current.expiresAt
                    || current.expiresAt > now
                ) {
                    return false;
                }

                const update = await tx.kycVerification.updateMany({
                    where: {
                        id: current.id,
                        status: "APPROVED",
                        revision: current.revision,
                        expiresAt: { lte: now },
                    },
                    data: {
                        status: "EXPIRED",
                        reasonCode: "APPROVAL_EXPIRED",
                        decidedAt: now,
                        revision: { increment: 1 },
                    },
                });
                if (update.count !== 1) return false;

                await tx.kycVerificationEvent.create({
                    data: {
                        verificationId: current.id,
                        actorType: "SYSTEM",
                        actorId: "cron:kyc-expiry",
                        fromStatus: "APPROVED",
                        toStatus: "EXPIRED",
                        reasonCode: "APPROVAL_EXPIRED",
                    },
                });
                await tx.auditEvent.create({
                    data: {
                        actor: "system:kyc-expiry",
                        action: "KYC_APPROVAL_EXPIRED",
                        resourceType: "KYC_VERIFICATION",
                        resourceId: current.id,
                        metadata: {
                            fromStatus: "APPROVED",
                            toStatus: "EXPIRED",
                            revision: current.revision + 1,
                        },
                    },
                });
                if (current.kind === "BUSINESS") {
                    await tx.merchant.updateMany({
                        where: { walletAddress: current.walletAddress },
                        data: { verified: false },
                    });
                }
                return true;
            });
            if (changed) expired += 1;
        }

        return NextResponse.json({
            success: true,
            examined: candidates.length,
            expired,
        });
    } catch (error) {
        console.error("KYC expiry reconciliation failed:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
