import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

import { ProtocolConfig } from "@/lib/payments/config";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { createPaymentSucceededWebhook } from "@/lib/webhooks";
import { deliverWebhookOutboxEvent } from "@/lib/webhookOutbox";
import { CCTP_CONFIG, ARC_CCTP_DOMAIN_ID, SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS, isProd } from "@/lib/contracts/constants";
import { ROUTER_DEPOSIT_INTERFACE, USDC_TRANSFER_INTERFACE, isReceiptId, receiptUrl } from "@/lib/arc/memo";
import { sendPaymentReceiptEmails } from "@/lib/email/transactional";
import { insertSupabaseDmAndNotify } from "@/lib/dms/notifications";
import {
    resolveFulfillmentAddress,
    validateBeneficiaryAddress,
} from "@/lib/paymentLinks/beneficiary";
import { isPeerRequestLink } from "@/lib/paymentLinks/classification";

export const maxDuration = 120;

const CCTP_MESSENGER_INTERFACE = new ethers.Interface([
    "event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)"
]);

const CCTP_RPCS: Record<number, string[]> = isProd
    ? {
        1: ["https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"]
      }
    : {
        11155111: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.ankr.com/eth_sepolia"]
      };

async function getTransactionReceiptWithFallback(chainId: number, txHash: string) {
    const urls = CCTP_RPCS[chainId] || [process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network"];
    let lastError = null;
    for (const url of urls) {
        try {
            const provider = new ethers.JsonRpcProvider(url);
            const [receipt, currentBlock] = await Promise.all([
                provider.getTransactionReceipt(txHash),
                provider.getBlockNumber()
            ]);
            if (receipt) {
                const tx = await provider.getTransaction(txHash);
                return { receipt, currentBlock, tx };
            }
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error("Failed to fetch receipt from all RPC endpoints");
}

async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function isUserPaymentLink(link: any) {
    /* Same peer/user-request predicate as /pay and the DM classifier — see isPeerRequestLink. */
    return isPeerRequestLink(link);
}

export async function POST(request: Request) {
    let executionKey = "";
    let supabase: any = null;

    try {
        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { txHash, paymentLinkId, payerAddress, receiptId, chainId: bodyChainId } = body;
        const chainId = bodyChainId ? Number(bodyChainId) : ProtocolConfig.CHAIN_ID;
        const isCctp = Number(chainId) in CCTP_CONFIG;
        const submittedReceiptId = isReceiptId(receiptId) ? receiptId : null;

        if (isCctp) {
            return NextResponse.json(
                {
                    error: "CCTP checkout verification is not enabled for hosted payment links yet. Use direct Arc payment so the on-chain DepositWithMemo event binds merchant, amount, and receipt token.",
                },
                { status: 400 }
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
        if (!isCctp && !submittedReceiptId) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid receiptId" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        supabase = createClient(supabaseUrl, supabaseServiceKey);
        const requestOrigin = request.headers.get("origin");

        /* Normalize address */
        const normalizedPayer = payerAddress.toLowerCase();
        const normalizedTx = txHash.toLowerCase();

        /* The database claim below owns idempotency, request binding, and capacity. */
        executionKey = `verify-payment-link:${normalizedTx}`;

        /* Fetch payment link details */
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
        if (!isCctp && submittedReceiptId !== finalReceiptId) {
            return NextResponse.json({ error: "Receipt token does not match this checkout session" }, { status: 400 });
        }
        if (isCctp && submittedReceiptId && submittedReceiptId !== finalReceiptId) {
            return NextResponse.json({ error: "Receipt token does not match this checkout session" }, { status: 400 });
        }

        /* Check circuit breakers */
        const { data: settings, error: settingsError } = await supabase
            .from("system_settings")
            .select("hosted_payments_enabled")
            .maybeSingle();

        if (settingsError) {
            console.error("[verify] Failed to read hosted payment settings:", settingsError.message);
            return NextResponse.json({ error: "Failed to validate payment availability" }, { status: 500 });
        }

        if (settings && settings.hosted_payments_enabled === false) {
            return NextResponse.json({ error: "Service Unavailable: Hosted payments are temporarily disabled." }, { status: 503 });
        }

        /* Atomically claim this exact request and reserve one use. A concurrent loser
           never proceeds into verification, and a tx hash cannot be rebound to another
           link, chain, payer, or receipt. */
        const expiresAt = new Date(Date.now() + ProtocolConfig.IDEMPOTENCY_TTL * 1000).toISOString();
        const { data: claimResult, error: claimError } = await supabase.rpc("claim_payment_link_settlement", {
            p_execution_key: executionKey,
            p_tx_hash: normalizedTx,
            p_chain_id: chainId,
            p_payment_link_id: paymentLink.id,
            p_payer_address: normalizedPayer,
            p_receipt_id: finalReceiptId,
            p_expires_at: expiresAt,
            p_create_ledger: !settlesDirectlyToUser,
        });

        if (claimError) {
            console.error("[verify] Failed to claim payment settlement:", claimError.message);
            return NextResponse.json({ error: "Failed to initialize payment verification" }, { status: 500 });
        }
        if (claimResult?.outcome === "COMPLETED") {
            const completedPaymentId = claimResult.responsePayload?.paymentId;
            after(async () => {
                if (completedPaymentId) {
                    await deliverWebhookOutboxEvent(supabase, `evt_payment_${completedPaymentId}`)
                        .catch((error) => console.error("[verify] Webhook outbox retry failed:", error));
                }
                /* Self-heal a settlement completed before its receipt row persisted (crash in
                   the old write order, or a receipt write that failed after finalization).
                   The claim fingerprint already bound tx → link → payer → receipt id, and the
                   payment row carries the verified block, so the receipt is rebuilt from
                   database truth rather than re-verifying the chain. */
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

                    const { error: repairError } = await supabase
                        .from("receipts")
                        .upsert({
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
                            block_number: paymentRow?.verification_block != null ? String(paymentRow.verification_block) : null,
                            confirmed_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, { onConflict: "receipt_id" });
                    if (repairError) {
                        console.error("[verify] Missing-receipt repair failed:", repairError.message);
                    } else {
                        console.warn(`[verify] Repaired missing receipt ${finalReceiptId} for settled tx ${normalizedTx}`);
                    }
                } catch (repairErr: any) {
                    console.error("[verify] Missing-receipt repair errored:", repairErr?.message || repairErr);
                }
            });
            return NextResponse.json(claimResult.responsePayload, { status: 200 });
        }
        if (claimResult?.outcome === "FINGERPRINT_MISMATCH") {
            return NextResponse.json({ error: "Transaction is already bound to a different payment request" }, { status: 409 });
        }
        if (claimResult?.outcome === "LINK_UNAVAILABLE") {
            return NextResponse.json({ error: "Payment link is inactive, expired, or at its usage limit" }, { status: 409 });
        }
        if (claimResult?.outcome !== "CLAIMED") {
            return NextResponse.json({ error: "Conflict: Verification in progress", status: "VERIFYING" }, { status: 409 });
        }

        /* Schedule the async verification job after the submit response. */
        after(async () => {
            try {
                let attempts = 0;
                const maxAttempts = 15;
                let confirmations = 0;

                while (attempts < maxAttempts) {
                    attempts++;
                    try {
                        let receipt: any;
                        let confirmations = 0;
                        let tx: any;

                        if (isCctp) {
                            const result = await getTransactionReceiptWithFallback(Number(chainId), normalizedTx);
                            receipt = result.receipt;
                            confirmations = Math.max(0, result.currentBlock - receipt.blockNumber + 1);
                            tx = result.tx;
                        } else {
                            const verifyResult = await executeWithRpcFallback(async (provider) => {
                                const [rcpt, currentBlock] = await Promise.all([
                                    provider.getTransactionReceipt(normalizedTx),
                                    provider.getBlockNumber()
                                ]);

                                if (!rcpt) {
                                    throw new Error("Transaction receipt not found on-chain yet");
                                }

                                const confs = currentBlock - rcpt.blockNumber + 1;
                                return { receipt: rcpt, confs };
                            });

                            receipt = verifyResult.result.receipt;
                            confirmations = Math.max(0, verifyResult.result.confs);
                        }

                        /* Update current confirmations count in DB */
                        const { error: confirmationUpdateError } = await supabase
                            .from("transaction_verifications")
                            .update({
                                status: "PENDING_CONFIRMATIONS",
                                confirmations,
                                updated_at: new Date().toISOString()
                            })
                            .eq("tx_hash", normalizedTx)
                            .eq("reference_type", "PAYMENT_LINK")
                            .eq("reference_id", paymentLink.id)
                            .neq("status", "CONFIRMED");
                        if (confirmationUpdateError) {
                            throw new Error(`Failed to persist transaction confirmations: ${confirmationUpdateError.message}`);
                        }

                        if (confirmations >= ProtocolConfig.MIN_CONFIRMATIONS) {
                            /* Verification phase */
                            const { error: verifyingUpdateError } = await supabase
                                .from("transaction_verifications")
                                .update({ status: "VERIFYING", updated_at: new Date().toISOString() })
                                .eq("tx_hash", normalizedTx)
                                .eq("reference_type", "PAYMENT_LINK")
                                .eq("reference_id", paymentLink.id)
                                .neq("status", "CONFIRMED");
                            if (verifyingUpdateError) {
                                throw new Error(`Failed to persist transaction verification state: ${verifyingUpdateError.message}`);
                            }

                            if (!isCctp) {
                                /* Validate parameters */
                                const txDetails = await executeWithRpcFallback(async (provider) => {
                                    return await provider.getTransaction(normalizedTx);
                                });

                                const nativeTx = txDetails.result;
                                if (!nativeTx) {
                                    throw new Error("Transaction details not found on-chain");
                                }
                                if (Number(nativeTx.chainId) !== ProtocolConfig.CHAIN_ID) {
                                    throw new Error(`Chain ID mismatch. Expected ${ProtocolConfig.CHAIN_ID}`);
                                }

                                if (receipt.status !== 1) {
                                    throw new Error("On-chain transaction reverted");
                                }

                                if (settlesDirectlyToUser) {
                                    if (!nativeTx.to || nativeTx.to.toLowerCase() !== USDC_NATIVE_GAS_ADDRESS.toLowerCase()) {
                                        throw new Error("Target contract is not Arc USDC for peer payment");
                                    }

                                    const parsedTransferCall = USDC_TRANSFER_INTERFACE.parseTransaction({
                                        data: nativeTx.data,
                                        value: nativeTx.value
                                    });
                                    if (
                                        !parsedTransferCall ||
                                        parsedTransferCall.name !== "transfer" ||
                                        parsedTransferCall.args[0].toLowerCase() !== paymentLink.merchant_address.toLowerCase() ||
                                        BigInt(parsedTransferCall.args[1]) !== BigInt(paymentLink.amount_usdc)
                                    ) {
                                        throw new Error("Direct USDC transfer does not match payment link parameters");
                                    }

                                    let transferFound = false;
                                    for (const log of receipt.logs) {
                                        if (log.address.toLowerCase() !== USDC_NATIVE_GAS_ADDRESS.toLowerCase()) continue;
                                        try {
                                            const parsed = USDC_TRANSFER_INTERFACE.parseLog({
                                                topics: log.topics,
                                                data: log.data
                                            });
                                            if (
                                                parsed &&
                                                parsed.name === "Transfer" &&
                                                parsed.args.from.toLowerCase() === normalizedPayer &&
                                                parsed.args.to.toLowerCase() === paymentLink.merchant_address.toLowerCase() &&
                                                BigInt(parsed.args.value) === BigInt(paymentLink.amount_usdc)
                                            ) {
                                                transferFound = true;
                                                break;
                                            }
                                        } catch {
                                            /* ignore */
                                        }
                                    }

                                    if (!transferFound) {
                                        throw new Error("Matching Arc USDC Transfer event not found");
                                    }
                                } else {
                                    if (!nativeTx.to || nativeTx.to.toLowerCase() !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase()) {
                                        throw new Error("Target contract is not SubScript Router contract");
                                    }

                                    const parsedRouterCall = ROUTER_DEPOSIT_INTERFACE.parseTransaction({
                                        data: nativeTx.data,
                                        value: nativeTx.value
                                    });
                                    if (
                                        !parsedRouterCall ||
                                        parsedRouterCall.name !== "depositForMerchant" ||
                                        parsedRouterCall.args[0].toLowerCase() !== paymentLink.merchant_address.toLowerCase() ||
                                        BigInt(parsedRouterCall.args[1]) !== BigInt(paymentLink.amount_usdc) ||
                                        parsedRouterCall.args[2] !== finalReceiptId
                                    ) {
                                        throw new Error("SubScript Router deposit call does not match receipt parameters");
                                    }

                                    /* Verify log event DepositWithMemo from SubScriptRouter */
                                    let logFound = false;
                                    for (const log of receipt.logs) {
                                        if (log.address.toLowerCase() !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase()) continue;
                                        try {
                                            const parsed = ROUTER_DEPOSIT_INTERFACE.parseLog({
                                                topics: log.topics,
                                                data: log.data
                                            });
                                            if (
                                                parsed &&
                                                parsed.name === "DepositWithMemo" &&
                                                parsed.args.payer.toLowerCase() === normalizedPayer &&
                                                parsed.args.merchant.toLowerCase() === paymentLink.merchant_address.toLowerCase() &&
                                                BigInt(parsed.args.amount) === BigInt(paymentLink.amount_usdc) &&
                                                parsed.args.memo === finalReceiptId
                                            ) {
                                                logFound = true;
                                                break;
                                            }
                                        } catch {
                                            /* ignore */
                                        }
                                    }

                                    if (!logFound) {
                                        throw new Error("SubScript Router DepositWithMemo event not found");
                                    }
                                }
                            } else {
                                /* CCTP Cross-chain transaction verification */
                                if (!tx) {
                                    throw new Error("CCTP transaction details not found on-chain");
                                }
                                if (Number(tx.chainId) !== Number(chainId)) {
                                    throw new Error(`Chain ID mismatch. Expected ${chainId}`);
                                }
                                if (receipt.status !== 1) {
                                    throw new Error("On-chain CCTP transaction reverted");
                                }

                                const cctpConfig = CCTP_CONFIG[Number(chainId)];
                                if (!cctpConfig) {
                                    throw new Error(`CCTP config not found for chain ID ${chainId}`);
                                }

                                if (!tx.to || tx.to.toLowerCase() !== cctpConfig.tokenMessenger.toLowerCase()) {
                                    throw new Error("Target contract is not CCTP TokenMessenger");
                                }

                                const mintRecipientBytes32 = ("0x" + SUBSCRIPT_ROUTER_ADDRESS.slice(2).padStart(64, "0")).toLowerCase();

                                /* Verify log event DepositForBurn */
                                let depositFound = false;
                                for (const log of receipt.logs) {
                                    if (log.address.toLowerCase() !== cctpConfig.tokenMessenger.toLowerCase()) continue;
                                    try {
                                        const parsed = CCTP_MESSENGER_INTERFACE.parseLog({
                                            topics: log.topics,
                                            data: log.data
                                        });
                                        if (
                                            parsed &&
                                            parsed.name === "DepositForBurn" &&
                                            parsed.args.burnToken.toLowerCase() === cctpConfig.usdc.toLowerCase() &&
                                            BigInt(parsed.args.amount) === BigInt(paymentLink.amount_usdc) &&
                                            parsed.args.depositor.toLowerCase() === normalizedPayer &&
                                            parsed.args.mintRecipient.toLowerCase() === mintRecipientBytes32 &&
                                            Number(parsed.args.destinationDomain) === ARC_CCTP_DOMAIN_ID
                                        ) {
                                            depositFound = true;
                                            break;
                                        }
                                    } catch {
                                        /* ignore */
                                    }
                                }

                                if (!depositFound) {
                                    throw new Error("CCTP DepositForBurn event with matching parameters not found");
                                }
                            }

                            /* Sweep funds if using ephemeral wallet (legacy/unused EOA receiver path retired) */
                            const sweepTxHash: string | null = null;
                            /* Auto-create SubScript account if it does not exist (flowchart requirement) */
                            try {
                                const { data: existingRole, error: roleQueryErr } = await supabase
                                    .from("account_roles")
                                    .select("role")
                                    .eq("address", normalizedPayer)
                                    .maybeSingle();

                                if (!roleQueryErr && !existingRole) {
                                    console.log(`[verify] Payer ${normalizedPayer} has no account. Auto-creating SubScript Account.`);
                                    await supabase
                                        .from("account_roles")
                                        .insert({
                                            address: normalizedPayer,
                                            role: "USER"
                                        });

                                    await supabase
                                        .from("customers")
                                        .insert({
                                            wallet_address: normalizedPayer,
                                        });

                                }
                            } catch (accErr) {
                                console.error("[verify] Failed to auto-create subscript account for payer:", accErr);
                            }

                            const shareUrl = receiptUrl(finalReceiptId, requestOrigin);

                            /* Persist the public receipt BEFORE the settlement is marked
                               COMPLETED. The on-chain payment is already verified at this point,
                               so the receipt reflects chain truth even if finalization retries;
                               the reverse order left a crash window where the claim was
                               COMPLETED but the receipt never existed — and every retry took the
                               completed fast-path, so it was never written. The payment row id
                               is back-filled after finalization. */
                            const { error: receiptError } = await supabase
                                .from("receipts")
                                .upsert({
                                    receipt_id: finalReceiptId,
                                    payment_link_id: paymentLink.id,
                                    tx_hash: normalizedTx,
                                    chain_id: Number(chainId),
                                    memo_contract: isCctp
                                        ? CCTP_CONFIG[Number(chainId)].tokenMessenger.toLowerCase()
                                        : settlesDirectlyToUser
                                        ? USDC_NATIVE_GAS_ADDRESS.toLowerCase()
                                        : SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
                                    payer_address: normalizedPayer,
                                    beneficiary_address: normalizedBeneficiary,
                                    merchant_address: paymentLink.merchant_address.toLowerCase(),
                                    amount_usdc: paymentLink.amount_usdc.toString(),
                                    memo_note: finalReceiptId,
                                    share_url: shareUrl,
                                    status: "CONFIRMED",
                                    block_number: receipt.blockNumber.toString(),
                                    confirmed_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                }, { onConflict: "receipt_id" });
                            if (receiptError) {
                                throw new Error(`Failed to persist payment receipt: ${receiptError.message}`);
                            }

                            const webhookPayload = settlesDirectlyToUser ? null : createPaymentSucceededWebhook({
                                paymentId: "pending",
                                checkoutSessionId: paymentLink.id,
                                merchantReference: paymentLink.external_reference || null,
                                amountUsdc: paymentLink.amount_usdc,
                                receiptId: finalReceiptId,
                                txHash: normalizedTx,
                                payerAddress: normalizedPayer,
                                beneficiaryAddress: normalizedBeneficiary,
                            });
                            const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
                                "finalize_payment_link_settlement",
                                {
                                    p_execution_key: executionKey,
                                    p_tx_hash: normalizedTx,
                                    p_chain_id: chainId,
                                    p_payment_link_id: paymentLink.id,
                                    p_payer_address: normalizedPayer,
                                    p_receipt_id: finalReceiptId,
                                    p_beneficiary_address: normalizedBeneficiary,
                                    p_verification_block: receipt.blockNumber,
                                    p_settlement_reference: settlesDirectlyToUser ? "direct-usdc-transfer" : sweepTxHash,
                                    p_response_payload: {
                                        success: true,
                                        message: "Payment verified and settled",
                                        payerAddress: normalizedPayer,
                                        beneficiaryAddress: normalizedBeneficiary,
                                        receiptId: finalReceiptId,
                                        shareUrl,
                                    },
                                    p_webhook_payload: webhookPayload,
                                },
                            );

                            if (finalizeError) {
                                throw new Error(`Failed to atomically finalize payment settlement: ${finalizeError.message}`);
                            }
                            const successPayload = finalizeResult?.responsePayload;
                            if (!successPayload?.paymentId) {
                                throw new Error("Atomic payment finalization returned no payment id");
                            }
                            const newPayment = { id: successPayload.paymentId };

                            /* Resolve the open request DM(s) for this link so the payer no longer sees the
                               merchant "asking" for something they just paid — the DEBIT_SUCCESS receipt DM
                               below is the record of success. Without this the PENDING PAYMENT_REQUEST lingers
                               and reads like a duplicate/looping request. Best-effort, idempotent. */
                            const { error: dmResolveError } = await supabase
                                .from("subscript_dms")
                                .update({ status: "APPROVED", updated_at: new Date().toISOString() })
                                .eq("payment_link_id", paymentLink.id)
                                .eq("receiver_address", normalizedPayer)
                                .in("message_type", ["PAYMENT_REQUEST", "PEER_REQUEST"])
                                .eq("status", "PENDING");
                            if (dmResolveError) {
                                console.error("[verify] Failed to resolve payment request DM:", dmResolveError.message);
                            }

                            /* Write audit event */
                            const { error: auditError } = await supabase
                                .from("audit_events")
                                .insert({
                                    actor: normalizedPayer,
                                    action: "PAYMENT_LINK_VERIFIED",
                                    resource_type: "PAYMENT_LINK",
                                    resource_id: paymentLink.id,
                                    metadata: {
                                        tx_hash: normalizedTx,
                                        amount_usdc: paymentLink.amount_usdc.toString(),
                                        payer_address: normalizedPayer,
                                        beneficiary_address: normalizedBeneficiary,
                                    }
                                });
                            if (auditError) {
                                console.error("[verify] Failed to record payment audit event:", auditError.message);
                            }

                            /* Back-link the pre-persisted receipt to the payment row created by
                               finalization. Best-effort: receipt_id + tx_hash already bind the
                               receipt to this settlement, the FK is informational. */
                            const { error: receiptLinkError } = await supabase
                                .from("receipts")
                                .update({ payment_link_payment_id: newPayment.id, updated_at: new Date().toISOString() })
                                .eq("receipt_id", finalReceiptId)
                                .is("payment_link_payment_id", null);
                            if (receiptLinkError) {
                                console.error("[verify] Failed to back-link receipt to payment row:", receiptLinkError.message);
                            }

                            const { data: payerSettings } = await supabase
                                .from("customers")
                                .select("push_enabled, debit_success_enabled")
                                .eq("wallet_address", normalizedPayer)
                                .maybeSingle();

                            if (payerSettings?.push_enabled !== false && payerSettings?.debit_success_enabled !== false) {
                                /* Every settled one-time payment surfaces as a receipt DM to the payer
                                   (idempotent on tx_hash) so it shows in the inbox by default — no longer
                                   gated on a pre-existing subscription thread. */
                                const { data: existingReceipt } = await supabase
                                    .from("subscript_dms")
                                    .select("id")
                                    .eq("message_type", "DEBIT_SUCCESS")
                                    .eq("tx_hash", normalizedTx)
                                    .limit(1)
                                    .maybeSingle();

                                if (!existingReceipt) {
                                    await insertSupabaseDmAndNotify(supabase, {
                                        sender_address: paymentLink.merchant_address.toLowerCase(),
                                        receiver_address: normalizedPayer,
                                        message_type: "DEBIT_SUCCESS",
                                        status: "PENDING",
                                        amount_usdc: paymentLink.amount_usdc.toString(),
                                        title: `Receipt: ${paymentLink.title}`,
                                        description: [
                                            `SubScript confirmed your ${Number(paymentLink.amount_usdc) / 1_000_000} USDC payment.`,
                                            `Paid to: ${paymentLink.merchant_name_snapshot || paymentLink.merchant_address}`,
                                            `Transaction: ${normalizedTx}`,
                                            `Receipt: ${shareUrl}`,
                                        ].filter(Boolean).join("\n"),
                                        tx_hash: normalizedTx,
                                        payment_link_id: paymentLink.id,
                                    }).catch((dmErr) =>
                                        console.error("[verify] receipt DM notification failed:", dmErr)
                                    );
                                }
                            }

                            await sendPaymentReceiptEmails({
                                amountUsdc: paymentLink.amount_usdc,
                                receiptUrl: shareUrl,
                                receiptId: finalReceiptId,
                                merchantAddress: paymentLink.merchant_address,
                                payerAddress: normalizedPayer,
                                paymentTitle: paymentLink.title,
                                txHash: normalizedTx,
                            });

                            if (!settlesDirectlyToUser) {
                                await deliverWebhookOutboxEvent(supabase, `evt_payment_${newPayment.id}`)
                                    .catch((error) => console.error("[verify] Webhook outbox delivery failed:", error));
                            }

                            return;
                        }
                    } catch (err: any) {
                        console.warn(`[verify-worker] Verification attempt ${attempts} failed: ${err.message}`);
                    }
                    await new Promise(res => setTimeout(res, 5000));
                }

                throw new Error("Verification timed out after max block polling attempts");

            } catch (jobErr: any) {
                console.error(`[verify-worker] Background job encountered terminal error:`, jobErr.message);

                /* Release only this exact request's reservation. The RPC refuses to
                   downgrade a confirmed settlement or a claim with another fingerprint. */
                const { error: releaseError } = await supabase.rpc("release_payment_link_settlement", {
                    p_execution_key: executionKey,
                    p_tx_hash: normalizedTx,
                    p_chain_id: chainId,
                    p_payment_link_id: paymentLink.id,
                    p_payer_address: normalizedPayer,
                    p_receipt_id: finalReceiptId,
                    p_error_message: jobErr.message || "Payment verification failed",
                });
                if (releaseError) {
                    console.error("[verify-worker] Failed to release settlement claim:", releaseError.message);
                }
            }
        });

        return NextResponse.json({
            success: true,
            message: "Transaction verification submitted",
            status: "SUBMITTED"
        }, { status: 202 });

    } catch (error: any) {
        console.error("Verification POST error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
