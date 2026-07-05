import { NextResponse } from "next/server";
import { verifyCircleSignature } from "@/lib/webhooks/circleSignature";

export async function POST(request: Request) {
    try {
        const bodyText = await request.text();
        if (!bodyText) {
            return NextResponse.json({ error: "Empty request body" }, { status: 400 });
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

        // Webhook signature verified successfully!
        return NextResponse.json({
            success: true,
            messageId: payload.MessageId || null,
        });
    } catch (err: any) {
        console.error("Webhook route processing failed:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
