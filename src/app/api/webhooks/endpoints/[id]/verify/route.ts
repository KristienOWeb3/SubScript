import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { authenticateMerchant } from "@/lib/v1/merchantAuth";
import { sendWebhookRequest, decryptWebhookSecret } from "@/lib/webhooks";
import { apiError } from "@/lib/apiErrors";

/* Finding 88: Endpoint verification handshake.
 *
 * POST /api/webhooks/endpoints/[id]/verify
 *
 * Sends a signed challenge to the endpoint URL. The endpoint must respond with the
 * challenge token in the response body. On success, the endpoint status transitions
 * from PENDING_VERIFICATION → ACTIVE.
 *
 * This prevents merchants from accidentally configuring endpoints that don't actually
 * handle SubScript webhooks, and prevents delivery attempts to broken URLs.
 */

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: endpointId } = await params;

        const auth = await authenticateMerchant(request);
        if (!auth.ok) {
            return apiError({ status: auth.status, code: "unauthorized", message: auth.error });
        }
        const walletAddress = auth.merchantAddress.toLowerCase();

        /* Validate endpoint ID format */
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(endpointId)) {
            return apiError({ status: 400, code: "invalid_endpoint_id", message: "endpointId must be a valid UUID" });
        }

        /* Load existing endpoint — must belong to this merchant */
        const endpoint = await prisma.webhookEndpoint.findFirst({
            where: { id: endpointId, walletAddress },
        });

        if (!endpoint) {
            return apiError({ status: 404, code: "endpoint_not_found", message: "Webhook endpoint not found" });
        }

        if (endpoint.status === "ACTIVE") {
            return NextResponse.json({
                success: true,
                endpoint_id: endpointId,
                status: "ACTIVE",
                message: "Endpoint is already verified and active.",
            });
        }

        /* Generate verification challenge */
        const challenge = crypto.randomBytes(32).toString("hex");
        const challengePayload = {
            id: `evt_verify_${crypto.randomBytes(8).toString("hex")}`,
            object: "event",
            type: "endpoint.verification",
            created_at: new Date().toISOString(),
            data: {
                challenge,
                endpoint_id: endpointId,
            },
        };

        /* Decrypt the signing secret for this endpoint */
        const signingSecret = decryptWebhookSecret({
            ciphertext: endpoint.ciphertext,
            nonce: endpoint.nonce,
            authenticationTag: endpoint.authenticationTag,
            endpointId,
            merchantAddress: walletAddress,
        });

        /* Send the challenge to the endpoint URL.
           The endpoint must respond with HTTP 200 and echo the challenge token. */
        const result = await sendWebhookRequest(
            endpoint.url,
            challengePayload,
            signingSecret,
            {
                eventId: challengePayload.id,
                deliveryId: `del_verify_${crypto.randomBytes(8).toString("hex")}`,
                attempt: 1,
                eventType: "endpoint.verification",
                apiVersion: "2026-07-01",
                environment: endpoint.environment,
            }
        );

        const success = result.status >= 200 && result.status < 300;

        if (!success) {
            return NextResponse.json({
                success: false,
                endpoint_id: endpointId,
                status: endpoint.status,
                http_status: result.status,
                message: `Verification failed. Endpoint responded with HTTP ${result.status}.`,
            }, { status: 422 });
        }

        /* Check that the response echoes the challenge */
        let responseChallenge: string | null = null;
        try {
            const parsed = JSON.parse(result.responseText || "{}");
            responseChallenge = parsed.challenge || null;
        } catch {
            /* Response might be plain text */
            responseChallenge = (result.responseText || "").trim();
        }

        if (responseChallenge !== challenge) {
            return NextResponse.json({
                success: false,
                endpoint_id: endpointId,
                status: endpoint.status,
                message: "Verification failed. The endpoint did not echo the challenge token correctly.",
            }, { status: 422 });
        }

        /* Transition to ACTIVE */
        await prisma.webhookEndpoint.update({
            where: { id: endpointId },
            data: { status: "ACTIVE" },
        });

        return NextResponse.json({
            success: true,
            endpoint_id: endpointId,
            status: "ACTIVE",
            message: "Endpoint verified successfully.",
        });
    } catch (error: any) {
        console.error("Endpoint verification error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error" });
    }
}
