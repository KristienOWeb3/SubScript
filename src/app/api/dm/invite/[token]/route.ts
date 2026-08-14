import { NextResponse } from "next/server";
import { resolveInviteToken } from "@/lib/dms/inviteTokens";
import { prisma } from "@/lib/prisma";
import { accountDisplayName } from "@/lib/identityDisplay";

type RouteContext = {
    params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
    try {
        const { token } = await params;
        if (!token) {
            return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
        }

        const resolution = await resolveInviteToken(token);
        if (!resolution.valid || !resolution.wallet) {
            return NextResponse.json({
                valid: false,
                status: resolution.status || "INVALID",
                error: resolution.error || "Invalid invite link",
            }, { status: resolution.status === "DISABLED" ? 403 : resolution.status === "REVOKED" ? 410 : 404 });
        }

        const targetWallet = resolution.wallet.toLowerCase();

        const [aliasRecord, customer] = await Promise.all([
            prisma.addressAlias.findUnique({
                where: { address: targetWallet },
                select: { alias: true, isAnonymous: true },
            }),
            prisma.customer.findUnique({
                where: { walletAddress: targetWallet },
                select: { profilePic: true },
            }),
        ]);

        const displayName = accountDisplayName(aliasRecord?.alias) || `${targetWallet.slice(0, 6)}...${targetWallet.slice(-4)}`;

        return NextResponse.json({
            valid: true,
            status: "VALID",
            recipient: {
                walletAddress: targetWallet,
                displayName,
                alias: aliasRecord?.alias || null,
                profilePic: customer?.profilePic || null,
            },
        }, { status: 200 });
    } catch (err: any) {
        console.error("Error resolving DM invite token:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
