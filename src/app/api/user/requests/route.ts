import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseUsdcToMicros, formatUsdcFromMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { requireAccountRole } from "@/lib/accounts/roles";

export async function POST(request: Request) {
    try {
        const requester = await getSessionWallet(request.headers);
        if (!requester) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(requester, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { receiverAddress, amountUsdc, title, description } = sanitizeInput(body);
        
        let normalizedReceiver: string | null = null;
        if (receiverAddress) {
            if (typeof receiverAddress !== "string" || !ethers.isAddress(receiverAddress)) {
                return NextResponse.json({ error: "Receiver address is invalid" }, { status: 400 });
            }
            normalizedReceiver = receiverAddress.toLowerCase();
            const normalizedRequester = requester.toLowerCase();
            if (normalizedRequester === normalizedReceiver) {
                return NextResponse.json({ error: "You cannot request USDC from yourself" }, { status: 400 });
            }
        }

        const normalizedRequester = requester.toLowerCase();
        const amountMicros = parseUsdcToMicros(amountUsdc);
        if (amountMicros <= 0) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        const cleanTitle = typeof title === "string" && title.trim()
            ? title.trim().slice(0, 120)
            : "USDC request";
        const cleanDescription = typeof description === "string" && description.trim()
            ? description.trim().slice(0, 500)
            : "Peer USDC request through SubScript.";

        await prisma.customer.upsert({
            where: { walletAddress: normalizedRequester },
            update: {},
            create: { walletAddress: normalizedRequester },
        });

        const paymentLink = await prisma.paymentLink.create({
            data: {
                merchantAddress: normalizedRequester,
                title: cleanTitle,
                description: cleanDescription,
                amountUsdc: amountMicros,
                active: true,
                maxUses: 1,
                merchantNameSnapshot: "SubScript user request",
                externalReference: `peer-request:${normalizedRequester}:${Date.now()}`,
            },
        });

        const amount = formatUsdcFromMicros(amountMicros);
        let dm = null;
        if (normalizedReceiver) {
            dm = await prisma.subscriptDm.create({
                data: {
                    senderAddress: normalizedRequester,
                    receiverAddress: normalizedReceiver,
                    messageType: "PEER_REQUEST",
                    status: "PENDING",
                    amountUsdc: amountMicros,
                    title: `${amount} USDC requested`,
                    description: [
                        cleanDescription,
                        `Requester: ${normalizedRequester}`,
                        `Amount: ${amount} USDC`,
                        "This is a structured SubScript payment request, not a free-form chat.",
                    ].join("\n"),
                    paymentLinkId: paymentLink.id,
                },
            });
        }

        return NextResponse.json({
            success: true,
            paymentLinkId: paymentLink.id,
            payUrl: `/pay/${paymentLink.id}`,
            dmId: dm?.id || null,
        }, { status: 201 });
    } catch (error: any) {
        console.error("Peer request creation failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
