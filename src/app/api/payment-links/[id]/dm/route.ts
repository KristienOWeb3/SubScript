import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createPaymentRequestDm } from "@/lib/dms/system";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        /* Legacy accounts (pre role-first signup) have no account_roles row. They are still
           valid logged-in payers, so heal them to USER instead of dead-ending the checkout
           with a "finish signup" error. Merchant wallets are still rejected. */
        const role = await resolveAccountRoleWithBackfill(wallet);
        if (role !== "USER") {
            return NextResponse.json({
                error: role === "ENTERPRISE"
                    ? "This action requires a user wallet. Merchant accounts can't receive payment-request DMs."
                    : "Unable to verify your account. Please try again.",
            }, { status: role === "ENTERPRISE" ? 403 : 500 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing payment link id" }, { status: 400 });
        }

        const { dm, created } = await createPaymentRequestDm({
            paymentLinkId: id,
            receiverAddress: wallet,
        });

        const host = request.headers.get("host") || "";
        const isProduction = host.includes("subscriptonarc.com") || host.includes("subscriptonarc");
        const protocol = request.headers.get("x-forwarded-proto") || "https";

        const dashboardUrl = isProduction
            ? `${protocol}://dashboard.subscriptonarc.com/user?tab=inbox&intent=${encodeURIComponent(id)}`
            : `/user?tab=inbox&intent=${encodeURIComponent(id)}`;

        return NextResponse.json({
            success: true,
            created,
            dm: {
                id: dm.id,
                paymentLinkId: dm.paymentLinkId,
                status: dm.status,
            },
            dashboardUrl,
        }, { status: created ? 201 : 200 });
    } catch (error: any) {
        const message = error?.message || "Failed to route payment request to DM";
        const status = /not found/i.test(message) ? 404 : /expired|inactive|exhausted/i.test(message) ? 410 : 400;
        return NextResponse.json({ error: message }, { status });
    }
}
