/* User-facing shareable payment links.
   Unlike /api/payment-links (merchant/ENTERPRISE only), this lets a standard USER
   mint a shareable link to RECEIVE USDC. Anyone who opens and pays the link is
   auto-onboarded as a SubScript user (handled in the verify route) and a DM thread
   is opened between payer and the link owner. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { createUserPaymentRequest } from "@/lib/userPaymentRequests";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";

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

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { amountUsdc, title, description, expiresInHours } = sanitizeInput(body);

        const amountMicros = parseUsdcToMicros(amountUsdc);
        if (amountMicros <= 0) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        const cleanTitle = typeof title === "string" && title.trim()
            ? title.trim().slice(0, 120)
            : "USDC payment";
        const cleanDescription = typeof description === "string" && description.trim()
            ? description.trim().slice(0, 500)
            : "SubScript payment link.";

        const parsedExpiresInHours = expiresInHours === undefined || expiresInHours === null || expiresInHours === ""
            ? null
            : Number(expiresInHours);
        if (parsedExpiresInHours !== null && (!Number.isFinite(parsedExpiresInHours) || parsedExpiresInHours < 1 || parsedExpiresInHours > 24 * 365)) {
            return NextResponse.json({ error: "Expiry must be between 1 hour and 365 days" }, { status: 400 });
        }
        const expiresAt = parsedExpiresInHours
            ? new Date(Date.now() + parsedExpiresInHours * 60 * 60 * 1000)
            : null;

        /* receiver: null + dmOnly: false => a shareable link (not bound to one payer). */
        const paymentRequest = await createUserPaymentRequest({
            requester: wallet.toLowerCase(),
            receiver: null,
            amountMicros,
            title: cleanTitle,
            description: cleanDescription,
            expiresAt,
            dmOnly: false,
        });

        const origin = request.headers.get("origin");
        return NextResponse.json({
            success: true,
            paymentLinkId: paymentRequest.paymentLinkId,
            checkoutUrl: buildCheckoutUrl(paymentRequest.paymentLinkId, origin),
        }, { status: 201 });
    } catch (error: any) {
        console.error("User payment link creation failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
