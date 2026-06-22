import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { requireAccountRole } from "@/lib/accounts/roles";
import { createUserPaymentRequest } from "@/lib/userPaymentRequests";

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

        const { receiverAddress, amountUsdc, title, description, expiresInDays } = sanitizeInput(body);

        let expiresAt: Date | null = null;
        if (expiresInDays !== null && expiresInDays !== undefined) {
            const days = Number(expiresInDays);
            if (!Number.isNaN(days) && days > 0 && days <= 365) {
                expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            }
        }

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

        const paymentRequest = await createUserPaymentRequest({
            requester: normalizedRequester,
            receiver: normalizedReceiver,
            amountMicros,
            title: cleanTitle,
            description: cleanDescription,
            expiresAt,
        });

        return NextResponse.json({
            success: true,
            paymentLinkId: paymentRequest.paymentLinkId,
            payUrl: `/pay/${paymentRequest.paymentLinkId}`,
            dmId: paymentRequest.dmId,
        }, { status: 201 });
    } catch (error: any) {
        console.error("Peer request creation failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
