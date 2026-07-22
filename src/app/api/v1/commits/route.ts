import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { apiError, getSecretKeyMode } from "@/lib/apiErrors";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { hashSecretKey } from "@/lib/apiKeys";
import { assertFinancialNetworkReady } from "@/lib/network/registry";

/* POST /api/v1/commits
   Generates a hosted Pay-As-You-Go (Vault Commit) checkout intent link.
   Merchants redirect users to `checkoutUrl` to complete a vault commitment
   authenticated via the user's server-signed embedded wallet.
*/
export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
    try {
        assertFinancialNetworkReady();

        let merchantAddress: string | null = null;
        let apiKeyMode: ReturnType<typeof getSecretKeyMode> | null = null;

        const sessionWallet = await getSessionWallet(request.headers);
        if (sessionWallet) {
            merchantAddress = sessionWallet.toLowerCase();
        } else {
            const authHeader = request.headers.get("Authorization");
            if (authHeader && authHeader.startsWith("Bearer ")) {
                const secretKey = authHeader.substring(7).trim();
                apiKeyMode = getSecretKeyMode(secretKey);
                if (apiKeyMode === "test" || apiKeyMode === "live") {
                    const keyRecord = await prisma.apiKey.findFirst({
                        where: {
                            revoked: false,
                            secretKeyHash: hashSecretKey(secretKey),
                        }
                    });
                    if (keyRecord) {
                        merchantAddress = keyRecord.walletAddress.toLowerCase();
                    }
                }
            }
        }

        if (!merchantAddress) {
            return apiError({
                status: 401,
                code: "unauthorized",
                requestId,
                message: "Unauthorized: Missing authentication credentials.",
            });
        }

        const body = await request.json().catch(() => ({}));
        const { amountUsdc, successUrl, cancelUrl, externalReference } = body || {};

        const checkoutUrl = `${buildCheckoutUrl(`/commit/${merchantAddress}`)}${
            amountUsdc ? `?amount=${encodeURIComponent(amountUsdc)}` : ""
        }`;

        return NextResponse.json({
            success: true,
            commitIntentId: `commit_${requestId.slice(0, 12)}`,
            merchantAddress,
            checkoutUrl,
            amountUsdc: amountUsdc ? String(amountUsdc) : "2.00",
            successUrl: successUrl || null,
            cancelUrl: cancelUrl || null,
            externalReference: externalReference || null,
        }, { status: 201 });
    } catch (error: any) {
        return apiError({
            status: 500,
            code: "internal_error",
            requestId,
            message: error.message || "Failed to create vault commit checkout intent",
        });
    }
}
