import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import {
    acceptDmRequest,
    declineDmRequest,
    cancelDmRequest,
} from "@/lib/dms/connections";
import { blockPeer } from "@/lib/dms/blocks";
import { prisma } from "@/lib/prisma";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing request id" }, { status: 400 });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { action } = body;

        if (action === "accept") {
            const result = await acceptDmRequest(id, wallet);
            return NextResponse.json({ success: true, peerAddress: result.peerAddress });
        }

        if (action === "decline") {
            const result = await declineDmRequest(id, wallet);
            return NextResponse.json({ success: true, request: result.request });
        }

        if (action === "cancel") {
            const result = await cancelDmRequest(id, wallet);
            return NextResponse.json({ success: true, request: result.request });
        }

        if (action === "block") {
            // Find the request to identify the peer
            const req = await prisma.dmRequest.findUnique({ where: { id } });
            if (!req) {
                return NextResponse.json({ error: "Request not found" }, { status: 404 });
            }
            const normWallet = wallet.toLowerCase();
            if (req.receiverAddress.toLowerCase() !== normWallet && req.senderAddress.toLowerCase() !== normWallet) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
            }
            const peerToBlock = req.receiverAddress.toLowerCase() === normWallet ? req.senderAddress : req.receiverAddress;
            await blockPeer(wallet, peerToBlock);
            return NextResponse.json({ success: true, blocked: peerToBlock });
        }

        return NextResponse.json({ error: "Invalid action. Expected 'accept', 'decline', 'cancel', or 'block'." }, { status: 400 });
    } catch (err: any) {
        console.error("Failed to process DM request action:", err);
        return NextResponse.json({ error: err.message || "Failed to process request" }, { status: 400 });
    }
}
