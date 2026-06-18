/* API route to fetch public merchant profile info (verified status, profile pic) */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const address = searchParams.get("address");

        if (!address || typeof address !== "string") {
            return NextResponse.json({ error: "Missing address parameter" }, { status: 400 });
        }

        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: address.toLowerCase() },
            select: {
                verified: true,
                profilePic: true,
                tier: true,
            }
        });

        if (!merchant) {
            return NextResponse.json({ verified: false, profilePic: null, tier: "FREE" }, { status: 200 });
        }

        return NextResponse.json({
            verified: merchant.verified,
            profilePic: merchant.profilePic,
            tier: merchant.tier,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to fetch merchant profile:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
