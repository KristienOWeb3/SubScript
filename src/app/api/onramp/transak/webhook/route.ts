/* Transak order webhook. Transak posts { eventID, webhookData } where webhookData
   is a JWT signed with our Partner Access Token; we verify it before trusting the
   order. The on-ramp is non-custodial — USDC is delivered straight to the user's
   wallet, so the user's on-chain balance refreshes on its own. This route records
   the order server-side for receipts/reconciliation; extend the marked block to
   persist or notify (e.g. a DM) if you want order history. */
import { NextResponse } from "next/server";
import { verifyTransakWebhook } from "@/lib/onramp/transak";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const webhookData = body?.webhookData;
        const eventID = typeof body?.eventID === "string" ? body.eventID : "UNKNOWN";

        if (typeof webhookData !== "string" || !webhookData) {
            return NextResponse.json({ error: "Missing webhookData" }, { status: 400 });
        }

        const order = await verifyTransakWebhook(webhookData);
        if (!order) {
            return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
        }

        const status = order?.status || "UNKNOWN";
        console.log(
            `[transak-webhook] event=${eventID} order=${order?.id} status=${status} ` +
            `wallet=${order?.walletAddress} amount=${order?.cryptoAmount} ${order?.cryptoCurrency} ` +
            `partnerOrderId=${order?.partnerOrderId ?? ""}`
        );

        /* --- Extension point -------------------------------------------------
           On status === "COMPLETED", the user's Arc wallet has been credited
           on-chain by Transak. Persist the order and/or notify the user here
           (e.g. insert a subscript_dms receipt keyed off order.walletAddress).
           Left out by default to avoid a schema change. */

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (err: any) {
        console.error("Transak webhook error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
