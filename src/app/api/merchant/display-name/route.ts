/* Self-serve merchant display-name confirmation.
 *
 * A merchant may set their business display name exactly once — during the one-time onboarding
 * modal, while display_name_locked is still false. The write is guarded on displayNameLocked=false
 * so it is atomic against a double submit. Once set, the name is locked and only a SubScript admin
 * can change it (via /admin); subsequent calls return 403. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeDisplayName } from "@/lib/merchants/identity";

const LOCKED_MESSAGE = "Your display name is locked. To change it, contact SubScript Support.";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }
        const normalizedWallet = wallet.toLowerCase();

        const body = await request.json().catch(() => null);
        const displayName = sanitizeDisplayName(body?.displayName);
        if (!displayName) {
            return NextResponse.json({ error: "Enter a display name." }, { status: 400 });
        }

        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: normalizedWallet },
            select: { displayNameLocked: true },
        });
        if (!merchant) {
            return NextResponse.json({ error: "Merchant account not found." }, { status: 404 });
        }
        if (merchant.displayNameLocked) {
            return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });
        }

        // Atomic set-once: only writes while still unlocked, so a concurrent submit can't double-set.
        const result = await prisma.merchant.updateMany({
            where: { walletAddress: normalizedWallet, displayNameLocked: false },
            data: { displayName, displayNameLocked: true },
        });
        if (result.count === 0) {
            return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });
        }

        const updated = await prisma.merchant.findUnique({
            where: { walletAddress: normalizedWallet },
            select: { merchantId: true, displayName: true, displayNameLocked: true },
        });
        return NextResponse.json({ success: true, ...updated }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to set merchant display name:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
