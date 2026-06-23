/* Public, address-keyed lookup used by the hosted checkout to decide whether to
   prompt a returning payer for their email. Returns only coarse booleans — no
   profile data — so it's safe to call without a session. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    try {
        const address = new URL(request.url).searchParams.get("address") || "";
        if (!ethers.isAddress(address)) {
            return NextResponse.json({ error: "Invalid address" }, { status: 400 });
        }
        const normalized = address.toLowerCase();

        const role = await getAccountRole(normalized);
        let hasEmail = false;
        if (role) {
            const customer = await prisma.customer.findUnique({
                where: { walletAddress: normalized },
                select: { email: true },
            });
            hasEmail = Boolean(customer?.email);
        }

        return NextResponse.json({
            exists: Boolean(role),
            hasEmail,
        }, { status: 200 });
    } catch (error: any) {
        console.error("payer-status lookup failed:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
