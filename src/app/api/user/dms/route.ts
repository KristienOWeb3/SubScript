/* API route to load and update system-automated DMs for the authenticated user */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const dms = await prisma.subscriptDm.findMany({
            where: {
                OR: [
                    { receiverAddress: wallet.toLowerCase() },
                    { senderAddress: wallet.toLowerCase() }
                ]
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        /* Collect unique addresses to fetch aliases */
        const uniqueAddresses = new Set<string>();
        dms.forEach((d: any) => {
            uniqueAddresses.add(d.senderAddress.toLowerCase());
            uniqueAddresses.add(d.receiverAddress.toLowerCase());
        });

        const aliases = await prisma.addressAlias.findMany({
            where: {
                address: { in: Array.from(uniqueAddresses) }
            }
        });

        const aliasMap = new Map(aliases.map((a: any) => [a.address.toLowerCase(), a.alias]));

        const formatted = dms.map((dm: any) => ({
            id: dm.id,
            senderAddress: dm.senderAddress,
            senderName: aliasMap.get(dm.senderAddress.toLowerCase()) || dm.senderAddress,
            receiverAddress: dm.receiverAddress,
            receiverName: aliasMap.get(dm.receiverAddress.toLowerCase()) || dm.receiverAddress,
            messageType: dm.messageType,
            status: dm.status,
            amountUsdc: dm.amountUsdc ? dm.amountUsdc.toString() : null,
            title: dm.title,
            description: dm.description,
            txHash: dm.txHash,
            paymentLinkId: dm.paymentLinkId,
            createdAt: dm.createdAt
        }));

        return NextResponse.json({ success: true, dms: formatted }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to load DMs:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { dmId, status } = sanitizedBody;

        if (typeof dmId !== "string" || !status) {
            return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
        }

        if (!["PENDING", "APPROVED", "DECLINED", "DISMISSED"].includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        /* Verify the DM exists and belongs to the user. Mutating actions are receiver-only. */
        const existingDm = await prisma.subscriptDm.findUnique({
            where: { id: dmId }
        });

        if (!existingDm) {
            return NextResponse.json({ error: "DM not found" }, { status: 404 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const isReceiver = existingDm.receiverAddress.toLowerCase() === normalizedWallet;
        const isSender = existingDm.senderAddress.toLowerCase() === normalizedWallet;

        if (!isReceiver && !isSender) {
            return NextResponse.json({ error: "Unauthorized access to DM" }, { status: 403 });
        }
        if (!isReceiver) {
            return NextResponse.json({ error: "Only the receiving account can confirm, decline, or dismiss this system DM" }, { status: 403 });
        }
        if (existingDm.status !== "PENDING") {
            return NextResponse.json({ error: "This DM has already been handled" }, { status: 409 });
        }
        if (status === "PENDING") {
            return NextResponse.json({ error: "Cannot reset a system DM to pending" }, { status: 400 });
        }

        const updatedDm = await prisma.subscriptDm.update({
            where: { id: dmId },
            data: { status }
        });

        return NextResponse.json({ 
            success: true, 
            dm: {
                id: updatedDm.id,
                status: updatedDm.status
            } 
        }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to update DM status:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
