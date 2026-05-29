import { NextResponse } from "next/server";

/**
 * @notice Production webhook endpoint for the SubScript protocol.
 *         Processes recurring billing success, failure, and subscription events.
 */
export async function POST(request: Request) {
    try {
        const signature = request.headers.get("x-subscript-signature");
        const body = await request.json().catch(() => null);

        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const { event, id, created, data } = body;

        console.log("SubScript Webhook event received:", {
            webhookId: id,
            event,
            created,
            signature,
            data
        });

        if (!event) {
            return NextResponse.json({ error: "Missing event type" }, { status: 400 });
        }

        // Process different event types
        switch (event) {
            case "subscription.session.created":
                // Handle webhook when a new customer checkout session is initialized
                console.log(`[Webhook] Session created: ${data.sessionId}`);
                break;
            case "subscription.payment.succeeded":
                // Handle webhook when keeper bot successfully processes a recurring charge
                console.log(`[Webhook] Payment Succeeded for subscription: ${data.subscriptionId}`);
                break;
            case "subscription.payment.failed":
                // Handle webhook when a recurring charge fails (e.g. due to insufficient USDC)
                console.log(`[Webhook] Payment Failed for subscription: ${data.subscriptionId}`);
                break;
            default:
                console.log(`[Webhook] Unhandled event type: ${event}`);
        }

        return NextResponse.json({ success: true, message: "Webhook successfully processed." });
    } catch (err: any) {
        console.error("Webhook route error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
