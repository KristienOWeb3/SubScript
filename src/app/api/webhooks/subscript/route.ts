import { after, NextResponse } from "next/server";
import crypto from "crypto";
import { triggerExitSurvey } from "@/lib/payments/email";
import {
    InboundWebhookPayloadError,
    processInboundSubscriptionWebhook,
} from "@/lib/subscriptions/inboundWebhook";

export async function POST(request: Request) {
    try {
        const signatureHeader = request.headers.get("x-subscript-signature");
        if (!signatureHeader) {
            return NextResponse.json({ error: "Unauthorized: Missing signature header" }, { status: 400 });
        }

        const match = signatureHeader.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
        if (!match) {
            return NextResponse.json({ error: "Unauthorized: Invalid signature format" }, { status: 400 });
        }

        const timestamp = Number(match[1]);
        if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
            return NextResponse.json({ error: "Unauthorized: Signature expired" }, { status: 400 });
        }

        const rawBody = await request.text();
        const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;
        if (!secret) {
            console.error("[Webhook Configuration Error] SUBSCRIPT_WEBHOOK_SECRET is not configured.");
            return NextResponse.json({ error: "Internal Server Error: Webhook secret is not configured" }, { status: 500 });
        }

        const computedSignature = crypto
            .createHmac("sha256", secret)
            .update(`${match[1]}.${rawBody}`)
            .digest("hex");
        const receivedBuffer = Buffer.from(match[2], "hex");
        const expectedBuffer = Buffer.from(computedSignature, "hex");
        if (
            receivedBuffer.length !== expectedBuffer.length
            || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
        ) {
            return NextResponse.json({ error: "Unauthorized: Signature mismatch" }, { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
            body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid JSON payload" }, { status: 400 });
        }

        const event = typeof body.event === "string" ? body.event : "";
        const data = body.data && typeof body.data === "object"
            ? body.data as Record<string, unknown>
            : null;
        if (!event || !data) {
            return NextResponse.json({ error: "Bad Request: Missing event or data payload" }, { status: 400 });
        }

        const rawTxHash = data.txHash || data.transactionHash;
        if (typeof rawTxHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawTxHash.trim())) {
            return NextResponse.json({ error: "Bad Request: Missing or malformed txHash" }, { status: 400 });
        }
        const txHash = rawTxHash.trim().toLowerCase();

        const merchantAddress = typeof data.merchant === "string"
            ? data.merchant.trim().toLowerCase()
            : "";
        if (!merchantAddress) {
            return NextResponse.json({ error: "Bad Request: Missing merchant address in data payload" }, { status: 400 });
        }

        const result = await processInboundSubscriptionWebhook({
            event,
            data,
            payload: body,
            txHash,
            merchantAddress,
        });

        if (result.outcome === "duplicate") {
            console.log(`[Webhook Replay Protected] tx_hash ${txHash} already processed. Ignoring event.`);
            return NextResponse.json({ success: true, message: "Duplicate transaction processed" });
        }
        if (result.outcome === "obsolete") {
            console.warn("[Webhook Obsolete Identity] Ignoring CUSTOMER event for a canonical premium subscription.");
            return NextResponse.json({ success: true, message: "Obsolete subscription identity ignored" });
        }

        if (result.merchantInfo?.tier === "PREMIUM") {
            console.log(`[Premium Rerouting Active] Payout mapping fetched for ${merchantAddress}:`, {
                tier: result.merchantInfo.tier,
                payoutDestination: result.merchantInfo.payout_destination || "Default connected address",
            });
        }

        if (result.exitSurveySubId !== null) {
            const surveySubId = result.exitSurveySubId;
            after(() => {
                triggerExitSurvey(merchantAddress, surveySubId, 0).catch((error) => {
                    console.error("Failed to trigger exit survey:", error);
                });
            });
        }

        return NextResponse.json({
            success: true,
            message: "Webhook receipt and subscription state committed atomically",
        });
    } catch (error) {
        if (error instanceof InboundWebhookPayloadError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("[Webhook Exception] Transaction rolled back; delivery is safe to retry.", error);
        return NextResponse.json({ error: "Database transaction failed" }, { status: 500 });
    }
}
