import { NextResponse } from "next/server";
import { verifyCircleSignature } from "@/lib/webhooks/circleSignature";
import { enqueuePaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;

function parseNotification(payload: any) {
    if (typeof payload?.Message !== "string") return payload;
    try {
        return JSON.parse(payload.Message);
    } catch {
        return { message: payload.Message };
    }
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.length > 0) || null;
}

export async function POST(request: Request) {
    try {
        const bodyText = await request.text();
        if (!bodyText) {
            return NextResponse.json({ error: "Empty request body" }, { status: 400 });
        }
        if (Buffer.byteLength(bodyText, "utf8") > MAX_WEBHOOK_BYTES) {
            return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
        }

        let payload: any;
        try {
            payload = JSON.parse(bodyText);
        } catch {
            return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
        }

        const signature = payload.Signature || request.headers.get("X-Circle-Signature");
        const signingCertUrl = payload.SigningCertURL || request.headers.get("X-Circle-Signing-Cert-URL");

        if (!signature || !signingCertUrl) {
            return NextResponse.json({ error: "Unauthorized: Webhook signature is required" }, { status: 401 });
        }

        // Reconstruct the SNS signable string if the message format is Type: Notification
        let signableString = "";
        if (payload.Type === "Notification") {
            const keys = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
            for (const key of keys) {
                if (payload[key] !== undefined) {
                    signableString += `${key}\n${payload[key]}\n`;
                }
            }
        } else {
            signableString = bodyText;
        }

        const isValid = await verifyCircleSignature(signature, signableString, signingCertUrl);
        if (!isValid) {
            return NextResponse.json({ error: "Unauthorized: Invalid webhook signature" }, { status: 401 });
        }

        const notification = parseNotification(payload);
        const eventId = firstString(
            payload.MessageId,
            notification?.notificationId,
            notification?.id,
        );
        if (!eventId || eventId.length > 200) {
            return NextResponse.json({ error: "Webhook event id is missing or invalid" }, { status: 400 });
        }
        const txHashCandidate = firstString(
            notification?.transaction?.txHash,
            notification?.transaction?.transactionHash,
            notification?.txHash,
            notification?.transactionHash,
        );
        const txHash = txHashCandidate && TX_HASH_PATTERN.test(txHashCandidate)
            ? txHashCandidate.toLowerCase()
            : null;
        const eventType = firstString(notification?.notificationType, notification?.type, payload.Type) || "UNKNOWN";
        const transactionStatus = firstString(
            notification?.transaction?.state,
            notification?.transaction?.status,
            notification?.state,
            notification?.status,
        );

        /* Persist before acknowledging. If the operations database is down we
           return 5xx so Circle retries instead of silently dropping the event. */
        await enqueuePaymentReconciliationRequired({
            dedupeKey: eventId,
            kind: "CIRCLE_TRANSACTION_NOTIFICATION",
            message: "Circle transaction notification queued for recovery",
            context: {
                eventId,
                eventType,
                transactionStatus,
                txHash,
                circleTransactionId: firstString(notification?.transaction?.id, notification?.transactionId),
                notification,
            },
        });

        return NextResponse.json({
            success: true,
            messageId: eventId,
        });
    } catch (err: any) {
        console.error("Webhook route processing failed:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
