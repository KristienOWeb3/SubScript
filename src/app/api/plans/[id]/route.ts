/* Public lookup for a single merchant subscription plan — powers the shareable
   /subscribe/[planId] page so a brand-new customer (no DM, no session) can see
   what they're subscribing to before they sign in. Read-only; active plans only. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing plan id" }, { status: 400 });
        }

        const plan = await prisma.merchantPlan.findUnique({ where: { id } }).catch(() => null);
        if (!plan || !plan.active) {
            return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
        }

        const merchantAddress = plan.merchantAddress.toLowerCase();
        const [alias, merchant, role] = await Promise.all([
            prisma.addressAlias.findUnique({ where: { address: merchantAddress } }).catch(() => null),
            prisma.merchant.findUnique({
                where: { walletAddress: merchantAddress },
                select: { verified: true, profilePic: true },
            }).catch(() => null),
            getAccountRole(merchantAddress).catch(() => null),
        ]);

        const merchantName = alias?.alias
            || `${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-4)}`;

        return NextResponse.json({
            success: true,
            plan: {
                id: plan.id,
                name: plan.name,
                amountUsdc: plan.amountUsdc.toString(),
                periodSeconds: plan.periodSeconds.toString(),
                merchantAddress,
            },
            merchant: {
                address: merchantAddress,
                name: merchantName,
                alias: alias?.alias || null,
                profilePic: merchant?.profilePic || null,
                verified: Boolean(merchant?.verified),
                isEnterprise: role === "ENTERPRISE",
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Public plan lookup failed:", error);
        return NextResponse.json({ error: error.message || "Failed to load plan" }, { status: 500 });
    }
}
