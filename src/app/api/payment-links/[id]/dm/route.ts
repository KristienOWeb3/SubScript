import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createPaymentRequestDm } from "@/lib/dms/system";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing payment link id" }, { status: 400 });
        }

        const { dm, created } = await createPaymentRequestDm({
            paymentLinkId: id,
            receiverAddress: wallet,
        });

        return NextResponse.json({
            success: true,
            created,
            dm: {
                id: dm.id,
                paymentLinkId: dm.paymentLinkId,
                status: dm.status,
            },
            dashboardUrl: `/dashboard/user?tab=inbox&intent=${encodeURIComponent(id)}`,
        }, { status: created ? 201 : 200 });
    } catch (error: any) {
        const message = error?.message || "Failed to route payment request to DM";
        const status = /not found/i.test(message) ? 404 : /expired|inactive|exhausted/i.test(message) ? 410 : 400;
        return NextResponse.json({ error: message }, { status });
    }
}
