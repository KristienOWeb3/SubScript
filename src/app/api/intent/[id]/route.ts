import { NextResponse } from "next/server";
import { getIntentStatus, resolveViewerMerchant } from "@/lib/intentStatus";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { origin } = new URL(request.url);
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing intent id" }, { status: 400 });
        }

        /* Anonymous callers get aggregate status only; the owning merchant (session or
           API key) additionally sees latestPayment (payer + tx proof). */
        const viewerMerchantAddress = await resolveViewerMerchant(request);
        const intent = await getIntentStatus(id, origin, { viewerMerchantAddress });
        if (!intent) {
            return NextResponse.json({ error: "Intent not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true, intent }, { status: 200 });
    } catch (error: any) {
        console.error("Intent retrieve error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
