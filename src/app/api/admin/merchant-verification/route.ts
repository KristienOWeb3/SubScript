import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export async function POST(request: Request) {
    try {
        const expectedKey = process.env.ADMIN_API_KEY;
        const providedKey = request.headers.get("x-admin-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!expectedKey || providedKey !== expectedKey) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { merchantAddress, verified, notes } = sanitizeInput(body);
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        if (typeof verified !== "boolean") {
            return NextResponse.json({ error: "verified must be a boolean" }, { status: 400 });
        }

        const normalizedMerchant = merchantAddress.toLowerCase();
        const merchant = await prisma.merchant.upsert({
            where: { walletAddress: normalizedMerchant },
            update: {
                verified,
                updatedAt: new Date(),
            },
            create: {
                walletAddress: normalizedMerchant,
                verified,
                tier: "FREE",
                availableBalanceUsdc: BigInt(0),
                reservedBalanceUsdc: BigInt(0),
            },
        });

        await prisma.auditEvent.create({
            data: {
                actor: "admin",
                action: verified ? "MERCHANT_VERIFIED" : "MERCHANT_UNVERIFIED",
                resourceType: "MERCHANT",
                resourceId: normalizedMerchant,
                metadata: {
                    notes: typeof notes === "string" ? notes.slice(0, 500) : null,
                    verified,
                },
            },
        });

        return NextResponse.json({
            success: true,
            merchant: {
                walletAddress: merchant.walletAddress,
                verified: merchant.verified,
            },
        });
    } catch (error: any) {
        console.error("Merchant verification update failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
