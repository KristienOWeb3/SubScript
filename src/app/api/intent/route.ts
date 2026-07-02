import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { ProtocolConfig } from "@/lib/payments/config";
import { apiError, getSecretKeyMode, isConfiguredPayoutDestination, merchantPayoutWalletMissingResponse } from "@/lib/apiErrors";
import { generateReceiptId } from "@/lib/arc/memo";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { hashSecretKey } from "@/lib/apiKeys";
import { arcReconciliation } from "@/lib/arc/reconciliation";

/* Validate an optional checkout return URL (https only, except localhost for dev). */
function validateReturnUrl(label: string, value: unknown): { ok: true; value?: string } | { ok: false; error: string } {
    if (value === undefined || value === null || value === "") return { ok: true };
    if (typeof value !== "string" || value.length > 2048) {
        return { ok: false, error: `Bad Request: ${label} must be a string up to 2048 characters` };
    }
    try {
        const u = new URL(value);
        const isLoopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
        const isAllowed = u.protocol === "https:" || (isLoopback && u.protocol === "http:");
        if (!isAllowed) {
            return { ok: false, error: `Bad Request: ${label} must be an https URL` };
        }
    } catch {
        return { ok: false, error: `Bad Request: ${label} is not a valid URL` };
    }
    return { ok: true, value };
}

async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    /* One request ID for every error this request can produce — clients quote it, logs carry it. */
    const requestId = crypto.randomUUID();
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
            return apiError({ status: 401, code: "unauthorized", requestId, message: "Unauthorized: Invalid or missing authentication credentials. Pass 'Authorization: Bearer sk_test_...' from Dashboard → Developers → API keys." });
        }

        // 2. Parse and validate body
        const body = await parseBody(request);
        if (!body) {
            return apiError({ status: 400, code: "invalid_json", requestId, message: "Bad Request: Invalid JSON body" });
        }

        const {
            title,
            description,
            amountUsdc,
            amountUsdcMicros,
            expiresAt,
            externalReference,
            idempotencyKey,
            merchantName,
            maxUses,
            successUrl,
            cancelUrl,
            sandbox
        } = body;
        const isSandboxRequest = sandbox === true || apiKeyMode === "test";

        if (!title || typeof title !== "string" || title.trim() === "") {
            return apiError({ status: 400, code: "missing_title", requestId, message: "Bad Request: title is required (a short product/plan name shown on the hosted checkout page)" });
        }
        if (externalReference !== undefined && externalReference !== null &&
            (typeof externalReference !== "string" || externalReference.trim().length === 0 || externalReference.length > 256)) {
            return apiError({ status: 400, code: "invalid_external_reference", requestId, message: "Bad Request: externalReference must be a non-empty string up to 256 characters" });
        }

        /* `amountUsdcMicros` is the canonical field name (integer micro-USDC); `amountUsdc` here has
           always been micro-USDC too and stays as an accepted alias. */
        const amountSource = (amountUsdcMicros !== undefined && amountUsdcMicros !== null && amountUsdcMicros !== "")
            ? amountUsdcMicros
            : amountUsdc;
        /* Only accept a plain positive decimal-integer string/number — BigInt() would otherwise
           coerce booleans, hex ("0x10"), etc., violating the micro-USDC contract. */
        const amountText = typeof amountSource === "number" && Number.isInteger(amountSource)
            ? String(amountSource)
            : typeof amountSource === "string"
                ? amountSource.trim()
                : "";
        if (!/^[1-9]\d*$/.test(amountText)) {
            return apiError({ status: 400, code: "invalid_amount", requestId, message: "Bad Request: amountUsdcMicros is required and must be a positive integer in micro-USDC (e.g. \"15000000\" = 15 USDC). amountUsdc is accepted as an alias with the same unit." });
        }
        const amountBigInt = BigInt(amountText);

        const successUrlCheck = validateReturnUrl("successUrl", successUrl);
        if (!successUrlCheck.ok) return apiError({ status: 400, code: "invalid_return_url", requestId, message: successUrlCheck.error });
        const cancelUrlCheck = validateReturnUrl("cancelUrl", cancelUrl);
        if (!cancelUrlCheck.ok) return apiError({ status: 400, code: "invalid_return_url", requestId, message: cancelUrlCheck.error });
        const returnUrls: Record<string, string> = {};
        if (successUrlCheck.value) returnUrls.successUrl = successUrlCheck.value;
        if (cancelUrlCheck.value) returnUrls.cancelUrl = cancelUrlCheck.value;
        const hasReturnUrls = Object.keys(returnUrls).length > 0;

        let parsedMaxUses: number | null = null;
        if (maxUses !== undefined && maxUses !== null && maxUses !== "") {
            const num = Number(maxUses);
            if (!Number.isInteger(num) || num <= 0 || num > 10000) {
                return apiError({ status: 400, code: "invalid_max_uses", requestId, message: "Bad Request: maxUses must be a positive integer up to 10000" });
            }
            parsedMaxUses = num;
        }

        // 3. Idempotency check
        if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
            const existing = await prisma.paymentLink.findFirst({
                where: { idempotencyKey, merchantAddress }
            });
            if (existing) {
                /* A subscription checkout is also a PaymentLink — never return one as a payment intent. */
                if ((existing.stateSnapshot as { subscription?: unknown } | null)?.subscription) {
                    return apiError({ status: 409, code: "idempotency_key_conflict", requestId, message: "Conflict: idempotencyKey was used for a different resource" });
                }
                const receiptToken = existing.receiptToken || generateReceiptId(existing.title);
                if (!existing.receiptToken) {
                    await prisma.paymentLink.update({
                        where: { id: existing.id },
                        data: { receiptToken },
                    });
                }
                const existingReturnUrls = (existing.stateSnapshot as { returnUrls?: Record<string, string> } | null)?.returnUrls;
                const existingSettlement = arcReconciliation();
                return NextResponse.json({
                    success: true,
                    intent: {
                        id: existing.id,
                        title: existing.title,
                        description: existing.description,
                        amountUsdc: existing.amountUsdc.toString(),
                        amountUsdcMicros: existing.amountUsdc.toString(),
                        merchantAddress: existing.merchantAddress,
                        receiverAddress: existing.receiverAddress,
                        status: existing.status,
                        receiptToken,
                        checkoutUrl: buildCheckoutUrl(existing.id),
                        chainId: existingSettlement.chainId,
                        usdcAddress: existingSettlement.usdcAddress,
                        ...(existingReturnUrls ? { returnUrls: existingReturnUrls } : {})
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
            return apiError({ status: 403, code: "quota_exceeded", requestId, message: `Quota Exceeded: Active link limit of ${limit} reached for your tier. Deactivate old links or upgrade in the dashboard.` });
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
                status: "PENDING",
                ...(hasReturnUrls ? { stateSnapshot: { returnUrls } } : {})
            }
        });

        const settlement = arcReconciliation();
        return NextResponse.json({
            success: true,
            intent: {
                id: newLink.id,
                checkoutSessionId: newLink.id,
                title: newLink.title,
                description: newLink.description,
                amountUsdc: newLink.amountUsdc.toString(),
                amountUsdcMicros: newLink.amountUsdc.toString(),
                merchantAddress: newLink.merchantAddress,
                receiverAddress: newLink.receiverAddress,
                status: newLink.status,
                receiptToken: newLink.receiptToken,
                checkoutUrl: buildCheckoutUrl(newLink.id),
                chainId: settlement.chainId,
                usdcAddress: settlement.usdcAddress,
                ...(hasReturnUrls ? { returnUrls } : {})
            },
            sandbox: isSandboxRequest
        }, { status: 201 });

    } catch (error: any) {
        /* Log the full error server-side, but never echo raw ORM/DB internals to the client. A
           leaked Prisma message (e.g. "column payment_links.beneficiary_address does not exist")
           is how a schema/migration gap becomes public — return a generic 500 instead. */
        console.error(`POST intent error [${requestId}]:`, error);
        return apiError({ status: 500, code: "internal_error", requestId, message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}
