import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));
    
    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

export async function POST(request: Request) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        /* Hard delete merchant accounts marked PENDING_DELETION created or updated before 30 days ago */
        const hardDeleted = await prisma.merchant.deleteMany({
            where: {
                closureStatus: "PENDING_DELETION",
                updatedAt: { lt: thirtyDaysAgo },
            },
        });

        return NextResponse.json({
            success: true,
            hardDeletedCount: hardDeleted.count,
        });
    } catch (error: any) {
        console.error("GDPR hard delete cron error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
