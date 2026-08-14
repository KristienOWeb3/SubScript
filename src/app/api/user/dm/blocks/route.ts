import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { listBlockedPeers, blockPeer, unblockPeer } from "@/lib/dms/blocks";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const blocked = await listBlockedPeers(wallet);
        return NextResponse.json({ success: true, blocked }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to list blocked peers:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { action, targetAddress } = body;
        if (!targetAddress || typeof targetAddress !== "string" || !targetAddress.startsWith("0x") || targetAddress.length !== 42) {
            return NextResponse.json({ error: "Valid target wallet address is required" }, { status: 400 });
        }

        if (action === "block") {
            await blockPeer(wallet, targetAddress);
            return NextResponse.json({ success: true, action: "blocked", targetAddress: targetAddress.toLowerCase() });
        }

        if (action === "unblock") {
            await unblockPeer(wallet, targetAddress);
            return NextResponse.json({ success: true, action: "unblocked", targetAddress: targetAddress.toLowerCase() });
        }

        return NextResponse.json({ error: "Invalid action. Expected 'block' or 'unblock'." }, { status: 400 });
    } catch (err: any) {
        console.error("Failed to update block state:", err);
        return NextResponse.json({ error: err.message || "Failed to update block state" }, { status: 400 });
    }
}
