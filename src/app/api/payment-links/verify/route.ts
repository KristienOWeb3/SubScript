import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

import { isReceiptId, receiptUrl } from "@/lib/arc/memo";
import { getSessionWallet } from "@/lib/auth";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { CCTP_CONFIG, SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import {
    resolveFulfillmentAddress,
    validateBeneficiaryAddress,
} from "@/lib/paymentLinks/beneficiary";
import { isPeerRequestLink } from "@/lib/paymentLinks/classification";
import { ProtocolConfig } from "@/lib/payments/config";
import { processPaymentLinkVerificationJobs } from "@/lib/payments/paymentLinkVerificationWorker";
import { deliverWebhookOutboxEvent } from "@/lib/webhookOutbox";

export const maxDuration = 120;

async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function isUserPaymentLink(link: any) {
    return isPeerRequestLink(link);
}

export async function POST(request: Request) {
    try {
        const requesterIp = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
        let rateLimit;
        try {
            rateLimit = await consumeDistributedRateLimit({
                scope: "payment-link-verification",
                key: requesterIp,
                limit: 10,
                windowSeconds: 60,
            });
        } catch (rateLimitError) {
            console.error("[verify] Distributed rate limiter unavailable:", rateLimitError);
            return NextResponse.json(
                { error: "Payment verification is temporarily unavailable" },
                { status: 503, headers: { "Retry-After": "5" } },
            );
        }
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "Too many payment-verification requests" },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { txHash, paymentLinkId, payerAddress, receiptId, chainId: bodyChainId, checkoutAttemptId } = body;
        const chainId = bodyChainId ? Number(bodyChainId) : ProtocolConfig.CHAIN_ID;
        const isCctp = Number(chainId) in CCTP_CONFIG;
        const submittedReceiptId = isReceiptId(receiptId) ? receiptId : null;

        /* Hosted payment links deliberately remain Arc-only until CCTP can bind
           the payment-link receipt token and merchant parameters on-chain. */
        if (isCctp) {
            return NextResponse.json(
                {
                    error: "CCTP checkout verification is not enabled for hosted payment links yet. Use direct Arc payment so the on-chain DepositWithMemo event binds merchant, amount, and receipt token.",
                },
                { status: 400 },
            );
        }

        if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid txHash" }, { status: 400 });
        }
        if (!paymentLinkId || typeof paymentLinkId !== "string") {
            return NextResponse.json({ error: "Bad Request: Missing or invalid paymentLinkId" }, { status: 400 });
        }
        if (!payerAddress || typeof payerAddress !== "string" || !ethers.isAddress(payerAddress)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid payerAddress" }, { status: 400 });
        }
        if (!submittedReceiptId) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid receiptId" }, { status: 400 });
        }
        if (
            typeof checkoutAttemptId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutAttemptId)
        ) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid checkout attempt" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const requestOrigin = request.headers.get("origin");
        const normalizedPayer = payerAddress.toLowerCase();
        const normalizedTx = txHash.toLowerCase();
        const executionKey = `verify-payment-link:${normalizedTx}`;

        const sessionWallet = await getSessionWallet(request.headers);
        if (!sessionWallet) {
            return NextResponse.json({ error: "Sign in with the paying wallet before verification." }, { status: 401 });
        }
        if (sessionWallet.toLowerCase() !== normalizedPayer) {
            return NextResponse.json({ error: "The authenticated wallet does not match the payer." }, { status: 403 });
        }
        const verifiedEmail = await getVerifiedAccountEmail(sessionWallet);
        if (!verifiedEmail?.email) {
            return NextResponse.json({ error: "Verify an email address with OTP before paying." }, { status: 403 });
        }

        const { data: paymentLink, error: linkError } = await supabase
            .from("payment_links")
            .select("*")
            .eq("id", paymentLinkId)
            .maybeSingle();
        if (linkError || !paymentLink) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }

        const settlesDirectlyToUser = isUserPaymentLink(paymentLink);
        const beneficiaryValidation = validateBeneficiaryAddress(
            paymentLink.beneficiary_address,
            paymentLink.merchant_address,
        );
        if (!beneficiaryValidation.ok) {
            return NextResponse.json(
                { error: "Payment link has an invalid beneficiary configuration" },
                { status: 409 },
            );
        }
        const explicitBeneficiary = beneficiaryValidation.address;
        const normalizedBeneficiary = resolveFulfillmentAddress(explicitBeneficiary, normalizedPayer);

        if (explicitBeneficiary) {
            const { data: beneficiaryRole, error: beneficiaryRoleError } = await supabase
                .from("account_roles")
                .select("role")
                .eq("address", explicitBeneficiary)
                .maybeSingle();
            if (beneficiaryRoleError) {
                console.error("[verify] Failed to validate payment-link beneficiary:", beneficiaryRoleError.message);
                return NextResponse.json({ error: "Failed to validate beneficiary account" }, { status: 500 });
            }
            if (beneficiaryRole?.role !== "USER") {
                return NextResponse.json(
                    { error: "Payment link beneficiary is no longer a registered SubScript USER" },
                    { status: 409 },
                );
            }
        }

        const paymentLinkReceiptId = isReceiptId(paymentLink.receipt_token) ? paymentLink.receipt_token : null;
        const finalReceiptId = paymentLinkReceiptId || submittedReceiptId;
        if (!finalReceiptId) {
            return NextResponse.json({ error: "Payment link is missing a valid receipt token" }, { status: 400 });
        }
        if (submittedReceiptId !== finalReceiptId) {
            return NextResponse.json({ error: "Receipt token does not match this checkout session" }, { status: 400 });
        }

        const { data: settings, error: settingsError } = await supabase
            .from("system_settings")
            .select("hosted_payments_enabled")
            .maybeSingle();
        if (settingsError) {
            console.error("[verify] Failed to read hosted payment settings:", settingsError.message);
            return NextResponse.json({ error: "Failed to validate payment availability" }, { status: 500 });
        }
        if (settings?.hosted_payments_enabled === false) {
            return NextResponse.json(
                { error: "Service Unavailable: Hosted payments are temporarily disabled." },
                { status: 503 },
            );
        }

        const expiresAt = new Date(Date.now() + ProtocolConfig.IDEMPOTENCY_TTL * 1000).toISOString();
        const { data: claimResult, error: claimError } = await supabase.rpc(
            "claim_payment_link_settlement_durable",
            {
                p_execution_key: executionKey,
                p_tx_hash: normalizedTx,
                p_chain_id: chainId,
                p_payment_link_id: paymentLink.id,
                p_payer_address: normalizedPayer,
                p_receipt_id: finalReceiptId,
                p_expires_at: expiresAt,
                p_create_ledger: !settlesDirectlyToUser,
                p_checkout_attempt_id: checkoutAttemptId,
                p_request_origin: requestOrigin,
            },
        );
        if (claimError) {
            console.error("[verify] Failed to claim payment settlement:", claimError.message);
            return NextResponse.json({ error: "Failed to initialize payment verification" }, { status: 500 });
        }

        if (claimResult?.outcome === "COMPLETED") {
            const completedPaymentId = claimResult.responsePayload?.paymentId;
            if (completedPaymentId) {
                const { error: attemptRepairError } = await supabase
                    .from("payment_link_payments")
                    .update({ checkout_attempt_id: checkoutAttemptId })
                    .eq("id", completedPaymentId)
                    .is("checkout_attempt_id", null);
                if (attemptRepairError) {
                    console.error("[verify] Checkout-attempt repair failed:", attemptRepairError.message);
                    return NextResponse.json({ error: "Failed to bind checkout attempt" }, { status: 500 });
                }
            }

            after(async () => {
                if (completedPaymentId) {
                    await deliverWebhookOutboxEvent(supabase, `evt_payment_${completedPaymentId}`)
                        .catch((error) => console.error("[verify] Webhook outbox retry failed:", error));
                }
                try {
                    const { data: existingReceipt } = await supabase
                        .from("receipts")
                        .select("receipt_id")
                        .eq("receipt_id", finalReceiptId)
                        .maybeSingle();
                    if (existingReceipt) return;

                    const { data: paymentRow } = await supabase
                        .from("payment_link_payments")
                        .select("id, verification_block")
                        .eq("tx_hash", normalizedTx)
                        .maybeSingle();
                    const { error: repairError } = await supabase.from("receipts").upsert({
                        receipt_id: finalReceiptId,
                        payment_link_id: paymentLink.id,
                        payment_link_payment_id: paymentRow?.id ?? null,
                        tx_hash: normalizedTx,
                        chain_id: Number(chainId),
                        memo_contract: settlesDirectlyToUser
                            ? USDC_NATIVE_GAS_ADDRESS.toLowerCase()
                            : SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
                        payer_address: normalizedPayer,
                        beneficiary_address: normalizedBeneficiary,
                        merchant_address: paymentLink.merchant_address.toLowerCase(),
                        amount_usdc: paymentLink.amount_usdc.toString(),
                        memo_note: finalReceiptId,
                        share_url: receiptUrl(finalReceiptId, requestOrigin),
                        status: "CONFIRMED",
                        block_number: paymentRow?.verification_block != null
                            ? String(paymentRow.verification_block)
                            : null,
                        confirmed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    }, { onConflict: "receipt_id" });
                    if (repairError) {
                        console.error("[verify] Missing-receipt repair failed:", repairError.message);
                    } else {
                        console.warn(`[verify] Repaired missing receipt ${finalReceiptId} for settled tx ${normalizedTx}`);
                    }
                } catch (repairError) {
                    console.error("[verify] Missing-receipt repair errored:", repairError);
                }
            });
            return NextResponse.json(claimResult.responsePayload, { status: 200 });
        }
        if (claimResult?.outcome === "FINGERPRINT_MISMATCH") {
            return NextResponse.json(
                { error: "Transaction is already bound to a different payment request" },
                { status: 409 },
            );
        }
        if (claimResult?.outcome === "LINK_UNAVAILABLE") {
            return NextResponse.json(
                { error: "Payment link is inactive, expired, or at its usage limit" },
                { status: 409 },
            );
        }

        if (claimResult?.outcome === "CLAIMED" || claimResult?.outcome === "IN_PROGRESS") {
            /* The durable job is already committed. `after` is only a low-latency
               dispatcher; the reconciliation keeper owns crash recovery. */
            after(async () => {
                await processPaymentLinkVerificationJobs(supabase, 1)
                    .catch((error) => console.error("[verify-worker] Immediate durable dispatch failed:", error));
            });
        }
        if (claimResult?.outcome === "IN_PROGRESS") {
            return NextResponse.json(
                { error: "Conflict: Verification in progress", status: "VERIFYING" },
                { status: 409 },
            );
        }
        if (claimResult?.outcome !== "CLAIMED") {
            return NextResponse.json(
                { error: "Conflict: Verification in progress", status: "VERIFYING" },
                { status: 409 },
            );
        }

        return NextResponse.json({
            success: true,
            message: "Transaction verification submitted",
            status: "SUBMITTED",
        }, { status: 202 });
    } catch (error) {
        console.error("Verification POST error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 },
        );
    }
}
