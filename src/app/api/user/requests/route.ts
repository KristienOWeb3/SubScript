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

        const { receiverAddress, amountUsdc, title, description, expiresInHours, dmOnly } = sanitizeInput(body);
        
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
        const parsedExpiresInHours = expiresInHours === undefined || expiresInHours === null || expiresInHours === ""
            ? null
            : Number(expiresInHours);
        if (parsedExpiresInHours !== null && (!Number.isFinite(parsedExpiresInHours) || parsedExpiresInHours < 1 || parsedExpiresInHours > 24 * 30)) {
            return NextResponse.json({ error: "Expiry must be between 1 hour and 30 days" }, { status: 400 });
        }
        const expiresAt = parsedExpiresInHours
            ? new Date(Date.now() + parsedExpiresInHours * 60 * 60 * 1000)
            : null;
        const isDmOnly = Boolean(dmOnly) && Boolean(normalizedReceiver);

        const paymentRequest = await createUserPaymentRequest({
            requester: normalizedRequester,
            receiver: normalizedReceiver,
            amountMicros,
            title: cleanTitle,
            description: cleanDescription,
            expiresAt,
            dmOnly: isDmOnly,
        });

        const responseBody: Record<string, unknown> = {
            success: true,
            paymentLinkId: paymentRequest.paymentLinkId,
            dmId: paymentRequest.dmId,
            shareable: !isDmOnly,
        };
        if (!isDmOnly) {
            responseBody.payUrl = `/pay/${paymentRequest.paymentLinkId}`;
        }

        return NextResponse.json(responseBody, { status: 201 });
    } catch (error: any) {
        console.error("Peer request creation failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
