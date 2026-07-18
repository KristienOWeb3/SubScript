import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { ProtocolConfig } from "@/lib/payments/config";
import { apiError, getSecretKeyMode, isConfiguredPayoutDestination, merchantPayoutWalletMissingResponse } from "@/lib/apiErrors";
import { generateReceiptId } from "@/lib/arc/memo";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { hashSecretKey } from "@/lib/apiKeys";
import { arcReconciliation } from "@/lib/arc/reconciliation";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";
import { ARC_TESTNET_CHAIN_ID, DEMO_MERCHANT_ADDRESS } from "@/lib/contracts/constants";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { normalizeMicrouscAmount, parsePaymentLinkExpiry } from "@/lib/paymentLinks/validation";
import { inspectPaymentIntentSemantics } from "@/lib/paymentIntentSemantics";

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
        /* Fail-closed: mainnet mode with incomplete network config must not serve financial
           routes (never silently fall back to a testnet address). No-op on testnet. */
        assertFinancialNetworkReady();

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
            return apiError({ status: 401, code: "unauthorized", requestId, message: "Unauthorized: Invalid or missing authentication credentials. Pass 'Authorization: Bearer sk_test_...' from Dashboard → Developers → API keys." });
        }

        /* The published signup-free demo key maps to a shared sandbox merchant: rate-limit it
           hard so docs-page experimentation can never crowd out real traffic. Test-mode keys
           are already forced to sandbox, so demo intents never touch settlement. */
        if (merchantAddress === DEMO_MERCHANT_ADDRESS.toLowerCase()) {
            const rl = checkProviderRateLimit({ provider: "demo-intents", key: merchantAddress, limit: 30, windowMs: 60_000 });
            if (!rl.ok) {
                return apiError({ status: 429, code: "rate_limited", requestId, message: "The shared demo key is rate limited. Create your own free test key at Dashboard → Developers → API keys." });
            }
        }

        // 2. Parse and validate body
        const body = await parseBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
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
            sandbox,
            confirmOneTime,
        } = body;
        if (confirmOneTime !== undefined && typeof confirmOneTime !== "boolean") {
            return apiError({
                status: 400,
                code: "invalid_confirm_one_time",
                requestId,
                message: "Bad Request: confirmOneTime must be a boolean. /api/intent creates one-time payments only.",
            });
        }
        const semanticCheck = inspectPaymentIntentSemantics(body);
        if (semanticCheck.recurringFields.length > 0) {
            return apiError({
                status: 400,
                code: "subscription_fields_on_payment_intent",
                requestId,
                message: `Bad Request: /api/intent creates one-time payments and does not accept recurring terms. Move ${semanticCheck.recurringFields.join(", ")} to POST /api/v1/plans (reusable DM-visible catalog plan) or POST /api/v1/subscriptions (subscription checkout).`,
            });
        }
        if (semanticCheck.recurringTextSignals.length > 0 && confirmOneTime !== true) {
            return apiError({
                status: 422,
                code: "ambiguous_recurring_product",
                requestId,
                message: "This product looks recurring, but /api/intent creates a one-time payment that will not appear in the merchant plan catalog or DM plan picker. Use POST /api/v1/plans or POST /api/v1/subscriptions. If this is intentionally a one-time pass, resend with confirmOneTime: true.",
            });
        }
        const isTestMode = apiKeyMode === "test";
        if (sandbox !== undefined && sandbox !== isTestMode) {
            return apiError({ status: 400, code: "invalid_sandbox_mode", requestId, message: "Bad Request: sandbox mode is determined by the API key" });
        }
        if (isTestMode && ProtocolConfig.CHAIN_ID !== ARC_TESTNET_CHAIN_ID) {
            return apiError({
                status: 409,
                code: "test_mode_requires_testnet",
                requestId,
                message: "Test API keys can settle Arc testnet USDC only. Use the testnet deployment or a live key for the configured network.",
            });
        }
        const isSandboxRequest = isTestMode;
        const isSimulationOnly = isTestMode && merchantAddress === DEMO_MERCHANT_ADDRESS.toLowerCase();
        const settlementChainId = isTestMode ? ARC_TESTNET_CHAIN_ID : ProtocolConfig.CHAIN_ID;

        if (!title || typeof title !== "string" || title.trim() === "") {
            return apiError({ status: 400, code: "missing_title", requestId, message: "Bad Request: title is required (a short one-time purchase name shown on the hosted checkout page)" });
        }
        if (title.length > 200) {
            return apiError({ status: 400, code: "invalid_title", requestId, message: "Bad Request: title must be 200 characters or fewer" });
        }
        if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 2000)) {
            return apiError({ status: 400, code: "invalid_description", requestId, message: "Bad Request: description must be a string up to 2000 characters" });
        }
        if (merchantName !== undefined && merchantName !== null && (typeof merchantName !== "string" || merchantName.length > 128)) {
            return apiError({ status: 400, code: "invalid_merchant_name", requestId, message: "Bad Request: merchantName must be a string up to 128 characters" });
        }
        if (idempotencyKey !== undefined && idempotencyKey !== null && (typeof idempotencyKey !== "string" || idempotencyKey.length > 200)) {
            return apiError({ status: 400, code: "invalid_idempotency_key", requestId, message: "Bad Request: idempotencyKey must be a string up to 200 characters" });
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
        const amountResult = normalizeMicrouscAmount(amountSource);
        if (!amountResult.ok) {
            return apiError({ status: 400, code: "invalid_amount", requestId, message: `Bad Request: ${amountResult.error}` });
        }
        const amountBigInt = amountResult.value;

        const expiryResult = parsePaymentLinkExpiry(expiresAt);
        if (!expiryResult.ok) {
            return apiError({ status: 400, code: "invalid_expiry", requestId, message: `Bad Request: ${expiryResult.error}` });
        }
        const parsedExpiresAt = expiryResult.value;

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
                const requestedFingerprint = {
                    merchantAddress,
                    amountUsdc: amountBigInt.toString(),
                    beneficiaryAddress: null,
                    linkKind: "MERCHANT",
                    sandboxMode: isSandboxRequest,
                    simulationOnly: isSimulationOnly,
                    settlementChainId,
                    maxUses: parsedMaxUses,
                    expiresAt: parsedExpiresAt?.toISOString() ?? null,
                };
                const storedFingerprint = (existing as any).creationFingerprint;
                const existingCreationFingerprint = storedFingerprint ? {
                    ...storedFingerprint,
                    simulationOnly: storedFingerprint.simulationOnly ?? (existing as any).simulationOnly,
                    settlementChainId: Number(storedFingerprint.settlementChainId ?? (existing as any).settlementChainId),
                } : null;
                if (existingCreationFingerprint
                    && (existingCreationFingerprint.merchantAddress !== requestedFingerprint.merchantAddress
                        || existingCreationFingerprint.amountUsdc !== requestedFingerprint.amountUsdc
                        || (existingCreationFingerprint.beneficiaryAddress ?? null) !== requestedFingerprint.beneficiaryAddress
                        || existingCreationFingerprint.linkKind !== requestedFingerprint.linkKind
                        || existingCreationFingerprint.sandboxMode !== requestedFingerprint.sandboxMode
                        || existingCreationFingerprint.simulationOnly !== requestedFingerprint.simulationOnly
                        || existingCreationFingerprint.settlementChainId !== requestedFingerprint.settlementChainId
                        || (existingCreationFingerprint.maxUses ?? null) !== requestedFingerprint.maxUses
                        || (existingCreationFingerprint.expiresAt ?? null) !== requestedFingerprint.expiresAt)) {
                    return apiError({ status: 409, code: "idempotency_key_conflict", requestId, message: "Conflict: idempotencyKey was used with different financial terms" });
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
                        object: "payment_intent",
                        paymentType: "one_time",
                        appearsInDmPlanPicker: false,
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
        if (!isSandboxRequest && !isConfiguredPayoutDestination(merchant?.payoutDestination)) {
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
                linkKind: "MERCHANT",
                sandboxMode: isSandboxRequest,
                simulationOnly: isSimulationOnly,
                settlementChainId,
                creationFingerprint: {
                    merchantAddress,
                    amountUsdc: amountBigInt.toString(),
                    beneficiaryAddress: null,
                    linkKind: "MERCHANT",
                    sandboxMode: isSandboxRequest,
                    simulationOnly: isSimulationOnly,
                    settlementChainId,
                    maxUses: parsedMaxUses,
                    expiresAt: parsedExpiresAt?.toISOString() ?? null,
                },
                ...(hasReturnUrls ? { stateSnapshot: { returnUrls } } : {})
            } as any
        });

        const settlement = arcReconciliation();
        return NextResponse.json({
            success: true,
            intent: {
                id: newLink.id,
                checkoutSessionId: newLink.id,
                object: "payment_intent",
                paymentType: "one_time",
                appearsInDmPlanPicker: false,
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
            sandbox: isSandboxRequest,
            simulationOnly: isSimulationOnly,
        }, { status: 201 });

    } catch (error: any) {
        /* Log the full error server-side, but never echo raw ORM/DB internals to the client. A
           leaked Prisma message (e.g. "column payment_links.beneficiary_address does not exist")
           is how a schema/migration gap becomes public — return a generic 500 instead. */
        console.error(`POST intent error [${requestId}]:`, error);
        return apiError({ status: 500, code: "internal_error", requestId, message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}
