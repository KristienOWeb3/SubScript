import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { listDmRequests, createDmRequest } from "@/lib/dms/connections";
import { resolveInviteToken } from "@/lib/dms/inviteTokens";

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

        const { received, sent } = await listDmRequests(wallet);
        const pendingCount = received.filter((r) => r.status === "PENDING").length;

        return NextResponse.json({
            success: true,
            received,
            sent,
            pendingCount,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to list DM requests:", err);
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

        const { inviteToken, receiverAddress, note } = body;

        let targetReceiver = receiverAddress;

        if (inviteToken) {
            const resolution = await resolveInviteToken(inviteToken);
            if (!resolution.valid || !resolution.wallet) {
                return NextResponse.json({
                    error: resolution.error || "This invite link is invalid or expired.",
                }, { status: 400 });
            }
            targetReceiver = resolution.wallet;
        }

        if (!targetReceiver || typeof targetReceiver !== "string" || !targetReceiver.startsWith("0x") || targetReceiver.length !== 42) {
            return NextResponse.json({ error: "Valid receiver wallet address or invite token is required" }, { status: 400 });
        }

        const createdRequest = await createDmRequest({
            senderWallet: wallet,
            receiverWallet: targetReceiver,
            note,
        });

        return NextResponse.json({
            success: true,
            request: {
                id: createdRequest.id,
                senderAddress: createdRequest.senderAddress,
                receiverAddress: createdRequest.receiverAddress,
                status: createdRequest.status,
                expiresAt: createdRequest.expiresAt,
            },
        }, { status: 201 });
    } catch (err: any) {
        console.error("Failed to create DM request:", err);
        const status = err.statusCode || (err.message?.includes("declined") ? 429 : 400);
        return NextResponse.json({ error: err.message || "Failed to create DM request" }, { status });
    }
}
