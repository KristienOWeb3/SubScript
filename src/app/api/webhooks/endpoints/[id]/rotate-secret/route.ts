import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { authenticateMerchant } from "@/lib/v1/merchantAuth";
import { encryptWebhookSecret } from "@/lib/webhooks";
import { apiError } from "@/lib/apiErrors";

/* Finding 78: Secret rotation endpoint.
 *
 * POST /api/webhooks/endpoints/[id]/rotate-secret
 *
 * Generates a new signing secret for the endpoint. The previous secret remains valid
 * for a bounded overlap period (default 24 hours) so merchants can roll their
 * verification code without downtime. During the overlap, the outbox worker signs
 * with both keys (current + previous), and the SDK's constructEvent tries both.
 */

const DEFAULT_OVERLAP_HOURS = 24;

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

        /* Generate new secret */
        const newSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
        const encrypted = encryptWebhookSecret(newSecret, endpointId, walletAddress);

        /* Archive current secret as previous (for overlap period) */
        const overlapHours = DEFAULT_OVERLAP_HOURS;
        const previousSecretExpiresAt = new Date(Date.now() + overlapHours * 60 * 60 * 1000);

        await prisma.webhookEndpoint.update({
            where: { id: endpointId },
            data: {
                /* Archive current → previous */
                previousCiphertext: endpoint.ciphertext,
                previousNonce: endpoint.nonce,
                previousAuthenticationTag: endpoint.authenticationTag,
                previousKeyVersion: "v1",
                previousSecretExpiresAt,
                /* Set new current */
                ciphertext: encrypted.ciphertext,
                nonce: encrypted.nonce,
                authenticationTag: encrypted.authenticationTag,
            },
        });

        return NextResponse.json({
            success: true,
            endpoint_id: endpointId,
            secret: newSecret,
            previous_secret_expires_at: previousSecretExpiresAt.toISOString(),
            overlap_hours: overlapHours,
            message: `New secret generated. Previous secret remains valid until ${previousSecretExpiresAt.toISOString()}.`,
        });
    } catch (error: any) {
        console.error("Secret rotation error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error" });
    }
}
