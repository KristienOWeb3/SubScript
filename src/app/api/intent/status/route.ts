import { NextResponse } from "next/server";
import { getIntentStatus } from "@/lib/intentStatus";

export async function GET(request: Request) {
    try {
        const { searchParams, origin } = new URL(request.url);
        const id = searchParams.get("id") || searchParams.get("paymentLinkId") || searchParams.get("intent");
        if (!id) {
            return NextResponse.json({ error: "Missing intent id" }, { status: 400 });
        }

        const intent = await getIntentStatus(id, origin);
        if (!intent) {
            return NextResponse.json({ error: "Intent not found" }, { status: 404 });
        }

        /* returnUrls are intentionally NOT exposed here: this endpoint is unauthenticated, so
           merchant app URLs / query state must not leak to anyone holding an intent id. */
        return NextResponse.json({
            success: true,
            intent,
        });
    } catch (error: any) {
        console.error("Intent status error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
