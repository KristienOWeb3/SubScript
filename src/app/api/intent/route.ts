import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { ProtocolConfig } from "@/lib/payments/config";
import { getSecretKeyMode, isConfiguredPayoutDestination, merchantPayoutWalletMissingResponse } from "@/lib/apiErrors";
import { generateReceiptId } from "@/lib/arc/memo";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { hashSecretKey } from "@/lib/apiKeys";

async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        let merchantAddress: string | null = null;
        let apiKeyMode: ReturnType<typeof getSecretKeyMode> | null = null;

        // 1. Authenticate via Session or API Key
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
                            OR: [{ secretKeyHash: hashSecretKey(secretKey) }, { secretKeyPlain: secretKey }],
                        }
                    });
                    if (keyRecord) {
                        merchantAddress = keyRecord.walletAddress.toLowerCase();
                    }
                }
            }
        }

        if (!merchantAddress) {
            return NextResponse.json({ error: "Unauthorized: Invalid or missing authentication credentials" }, { status: 401 });
        }

        // 2. Parse and validate body
        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const {
            title,
            description,
            amountUsdc,
            expiresAt,
            externalReference,
            idempotencyKey,
            merchantName,
            maxUses,
            sandbox
        } = body;
        const isSandboxRequest = sandbox === true || apiKeyMode === "test";

        if (!title || typeof title !== "string" || title.trim() === "") {
            return NextResponse.json({ error: "Bad Request: Title is required" }, { status: 400 });
        }
        if (externalReference !== undefined && externalReference !== null &&
            (typeof externalReference !== "string" || externalReference.trim().length === 0 || externalReference.length > 256)) {
            return NextResponse.json({ error: "Bad Request: externalReference must be a non-empty string up to 256 characters" }, { status: 400 });
        }

        let amountBigInt: bigint;
        try {
            amountBigInt = BigInt(amountUsdc);
            if (amountBigInt <= BigInt(0)) {
                return NextResponse.json({ error: "Bad Request: Amount must be greater than 0" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid amountUsdc" }, { status: 400 });
        }

        let parsedMaxUses: number | null = null;
        if (maxUses !== undefined && maxUses !== null && maxUses !== "") {
            const num = Number(maxUses);
            if (!Number.isInteger(num) || num <= 0 || num > 10000) {
                return NextResponse.json({ error: "Bad Request: maxUses must be a positive integer" }, { status: 400 });
            }
            parsedMaxUses = num;
        }

        // 3. Idempotency check
        if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
            const existing = await prisma.paymentLink.findFirst({
                where: { idempotencyKey }
            });
            if (existing) {
                const receiptToken = existing.receiptToken || generateReceiptId(existing.title);
                if (!existing.receiptToken) {
                    await prisma.paymentLink.update({
                        where: { id: existing.id },
                        data: { receiptToken },
                    });
                }
                return NextResponse.json({
                    success: true,
                    intent: {
                        id: existing.id,
                        title: existing.title,
                        description: existing.description,
                        amountUsdc: existing.amountUsdc.toString(),
                        merchantAddress: existing.merchantAddress,
                        receiverAddress: existing.receiverAddress,
                        status: existing.status,
                        receiptToken,
                        checkoutUrl: buildCheckoutUrl(existing.id)
                    }
                }, { status: 200 });
            }
        }

        // 4. Enforce quota limits
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress }
        });
        if (apiKeyMode === "live" && !isSandboxRequest && !isConfiguredPayoutDestination(merchant?.payoutDestination)) {
            return merchantPayoutWalletMissingResponse();
        }
        const tier = merchant?.tier || "FREE";

        const activeCount = await prisma.paymentLink.count({
            where: {
                merchantAddress,
                active: true,
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            }
        });

        const limit = tier === "PREMIUM" ? ProtocolConfig.MAX_PAYMENT_LINKS_TIER1 : ProtocolConfig.MAX_PAYMENT_LINKS_TIER0;
        if (activeCount >= limit) {
            return NextResponse.json({
                error: `Quota Exceeded: Active link limit of ${limit} reached for your tier.`
            }, { status: 403 });
        }

        let parsedExpiresAt: Date | null = null;
        if (expiresAt) {
            const num = Number(expiresAt);
            if (!isNaN(num)) {
                parsedExpiresAt = new Date(num < 10000000000 ? num * 1000 : num);
            } else {
                parsedExpiresAt = new Date(expiresAt);
            }
        }

        // 6. Insert new PaymentLink
        const newLink = await prisma.paymentLink.create({
            data: {
                merchantAddress,
                title,
                description: description || null,
                amountUsdc: amountBigInt,
                active: true,
                expiresAt: parsedExpiresAt,
                externalReference: externalReference || null,
                idempotencyKey: idempotencyKey || null,
                merchantNameSnapshot: merchantName || null,
                receiptToken: generateReceiptId(title),
                maxUses: parsedMaxUses,
                status: "PENDING"
            }
        });

        return NextResponse.json({
            success: true,
            intent: {
                id: newLink.id,
                checkoutSessionId: newLink.id,
                title: newLink.title,
                description: newLink.description,
                amountUsdc: newLink.amountUsdc.toString(),
                merchantAddress: newLink.merchantAddress,
                receiverAddress: newLink.receiverAddress,
                status: newLink.status,
                receiptToken: newLink.receiptToken,
                checkoutUrl: buildCheckoutUrl(newLink.id)
            },
            sandbox: isSandboxRequest
        }, { status: 201 });

    } catch (error: any) {
        console.error("POST intent error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
