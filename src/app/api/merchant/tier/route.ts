import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { getAccountKycTier } from "@/lib/kyc/tier";

export async function GET(request: Request) {
    try {
        const sessionWallet = await getSessionWallet(request.headers);
        if (!sessionWallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const tierInfo = await getAccountKycTier(sessionWallet);
        return NextResponse.json({
            tier: tierInfo.tier,
            tierLabel: tierInfo.tierLabel,
            isTier1: tierInfo.isTier1,
            email: tierInfo.email,
            isEmbedded: tierInfo.isEmbedded,
            hasKycApproval: tierInfo.hasKycApproval,
        }, { status: 200 });
    } catch (error) {
        console.error("Tier API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
