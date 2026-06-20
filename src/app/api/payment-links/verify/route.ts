import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptPrivateKey } from "@/lib/crypto";
import { ethers } from "ethers";

async function sweepEphemeralWallet(receiverPrivateKeyEncrypted: string, merchantAddress: string) {
    try {
        const privateKey = decryptPrivateKey(receiverPrivateKeyEncrypted);
        const rpcUrl = process.env.ARC_RPC_PRIMARY || "https://rpc.testnet.arc.network";
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);

        const balance = await provider.getBalance(wallet.address);
        if (balance === BigInt(0)) {
            console.log(`[sweep] No balance to sweep from ephemeral wallet ${wallet.address}`);
            return null;
        }

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
        const gasLimit = BigInt(21000); // Standard native transfer gas limit
        const fee = gasPrice * gasLimit;

        if (balance <= fee) {
            console.warn(`[sweep] Ephemeral wallet balance (${balance.toString()}) is too low to pay gas fee (${fee.toString()})`);
            return null;
        }

        const sweepAmount = balance - fee;
        console.log(`[sweep] Sweeping ${sweepAmount.toString()} USDC (native) from ${wallet.address} to merchant ${merchantAddress}`);

        const tx = await wallet.sendTransaction({
            to: merchantAddress,
            value: sweepAmount,
            gasLimit,
            gasPrice
        });

        console.log(`[sweep] Sweep transaction submitted: ${tx.hash}`);
        await tx.wait();
        console.log(`[sweep] Sweep transaction confirmed: ${tx.hash}`);
        return tx.hash;
    } catch (err: any) {
        console.error("[sweep] Sweep execution failed:", err);
        return null;
    }
}

import { ProtocolConfig } from "@/lib/payments/config";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { addressToBuffer } from "@/lib/payments/address";
import { createPaymentSucceededWebhook, sendWebhookRequest } from "@/lib/webhooks";
import { CCTP_CONFIG, ARC_CCTP_DOMAIN_ID, SUBSCRIPT_ROUTER_ADDRESS, isProd } from "@/lib/contracts/constants";
import { ROUTER_DEPOSIT_INTERFACE, isReceiptId, receiptUrl } from "@/lib/arc/memo";
import { sendPaymentReceiptEmails } from "@/lib/email/transactional";

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

        if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid txHash" }, { status: 400 });
        }

        if (!paymentLinkId || typeof paymentLinkId !== "string") {
            return NextResponse.json({ error: "Bad Request: Missing or invalid paymentLinkId" }, { status: 400 });
        }

        if (!payerAddress || typeof payerAddress !== "string" || !ethers.isAddress(payerAddress)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid payerAddress" }, { status: 400 });
        }
        if (!isCctp && !isReceiptId(receiptId)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid receiptId" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Normalize address */
        const normalizedPayer = payerAddress.toLowerCase();
        const normalizedTx = txHash.toLowerCase();

        /* Enforce Idempotency */
        executionKey = `verify-payment-link:${normalizedTx}`;
        const { data: existingKey } = await supabase
            .from("idempotency_keys")
            .select("*")
            .eq("execution_key", executionKey)
            .maybeSingle();

        if (existingKey) {
            if (existingKey.status === "PROCESSING") {
                return NextResponse.json({ error: "Conflict: Verification in progress", status: "VERIFYING" }, { status: 409 });
            }
            if (existingKey.status === "COMPLETED") {
                return NextResponse.json(existingKey.response_payload, { status: 200 });
            }
        }

        /* Fetch payment link details */
        const { data: paymentLink, error: linkError } = await supabase
            .from("payment_links")
            .select("*")
            .eq("id", paymentLinkId)
            .maybeSingle();

        if (linkError || !paymentLink) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }
        if (!isCctp && receiptId !== paymentLink.receipt_token) {
            return NextResponse.json({ error: "Receipt token does not match this checkout session" }, { status: 400 });
        }

        /* Check circuit breakers */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("hosted_payments_enabled")
            .maybeSingle();

        if (settings && settings.hosted_payments_enabled === false) {
            return NextResponse.json({ error: "Service Unavailable: Hosted payments are temporarily disabled." }, { status: 503 });
        }

        /* Verify no duplicate credit exists in payment_link_payments */
        const { data: priorPayment } = await supabase
            .from("payment_link_payments")
            .select("id")
            .eq("tx_hash", normalizedTx)
            .maybeSingle();

        if (priorPayment) {
            const responsePayload = { success: true, message: "Transaction already processed" };
            return NextResponse.json(responsePayload, { status: 200 });
        }

        /* Create idempotency key in PROCESSING state */
        const expiresAt = new Date(Date.now() + ProtocolConfig.IDEMPOTENCY_TTL * 1000).toISOString();
        await supabase
            .from("idempotency_keys")
            .insert({
                execution_key: executionKey,
                status: "PROCESSING",
                expires_at: expiresAt,
                response_payload: null
            });

        /* Phase 1: Initialize transaction verification in SUBMITTED state */
        await supabase
            .from("transaction_verifications")
            .upsert({
                tx_hash: normalizedTx,
                status: "SUBMITTED",
                reference_type: "PAYMENT_LINK",
                reference_id: paymentLink.id,
                confirmations: 0,
                updated_at: new Date().toISOString()
            });

        /* Create pending credit ledger entry with binary bytea address representation */
        const merchantBuf = addressToBuffer(paymentLink.merchant_address);
        await supabase
            .from("ledger_entries")
            .insert({
                merchant_address: merchantBuf,
                entry_type: "CREDIT_PAYMENT_LINK",
                status: "PENDING",
                amount_usdc: paymentLink.amount_usdc.toString(),
                reference_type: "PAYMENT_LINK",
                reference_id: paymentLink.id,
                tx_hash: normalizedTx
            });

        /* Spawn the async verification job in the background (Non-Blocking) */
        (async () => {
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
                        await supabase
                            .from("transaction_verifications")
                            .update({
                                status: "PENDING_CONFIRMATIONS",
                                confirmations,
                                updated_at: new Date().toISOString()
                            })
                            .eq("tx_hash", normalizedTx);

                        if (confirmations >= ProtocolConfig.MIN_CONFIRMATIONS) {
                            /* Verification phase */
                            await supabase
                                .from("transaction_verifications")
                                .update({ status: "VERIFYING", updated_at: new Date().toISOString() })
                                .eq("tx_hash", normalizedTx);

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
                                    parsedRouterCall.args[2] !== receiptId
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
                                            parsed.args.memo === receiptId
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

                            /* Verification successful: Transition to Phase 2 (FINALIZED) */
                            await supabase.rpc("lock_merchant_row", {
                                p_wallet_address: paymentLink.merchant_address.toLowerCase()
                            });

                            /* Sweep funds if using ephemeral wallet */
                            let sweepTxHash: string | null = null;
                            if (paymentLink.receiver_address && paymentLink.receiver_private_key) {
                                console.log(`[verify] Running sweep for ephemeral wallet: ${paymentLink.receiver_address}`);
                                sweepTxHash = await sweepEphemeralWallet(
                                    paymentLink.receiver_private_key,
                                    paymentLink.merchant_address
                                );
                            }

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
                                            wallet_address: normalizedPayer
                                        });
                                }
                            } catch (accErr) {
                                console.error("[verify] Failed to auto-create subscript account for payer:", accErr);
                            }

                            /* Update payment link status, record details, and increment use count */
                            await supabase
                                .from("payment_links")
                                .update({
                                    use_count: (paymentLink.use_count || 0) + 1,
                                    status: "PAID",
                                    paid_at: new Date().toISOString(),
                                    verified_tx_hash: normalizedTx,
                                    settlement_reference: sweepTxHash
                                })
                                .eq("id", paymentLink.id);

                            /* Create payment_link_payments record */
                            const { data: newPayment } = await supabase
                                .from("payment_link_payments")
                                .insert({
                                    payment_link_id: paymentLink.id,
                                    payer_address: normalizedPayer,
                                    amount_usdc: paymentLink.amount_usdc.toString(),
                                    tx_hash: normalizedTx,
                                    merchant_address: paymentLink.merchant_address.toLowerCase(),
                                    credited: true,
                                    credited_at: new Date().toISOString(),
                                    verification_block: receipt.blockNumber.toString(),
                                    verification_chain_id: chainId.toString()
                                })
                                .select()
                                .single();

                            /* Finalize pending ledger entry */
                            await supabase
                                .from("ledger_entries")
                                .update({ status: "FINALIZED" })
                                .eq("tx_hash", normalizedTx);

                            /* Update transaction status */
                            await supabase
                                .from("transaction_verifications")
                                .update({
                                    status: "CONFIRMED",
                                    updated_at: new Date().toISOString()
                                })
                                .eq("tx_hash", normalizedTx);

                            /* Write audit event */
                            await supabase
                                .from("audit_events")
                                .insert({
                                    actor: normalizedPayer,
                                    action: "PAYMENT_LINK_VERIFIED",
                                    resource_type: "PAYMENT_LINK",
                                    resource_id: paymentLink.id,
                                    metadata: {
                                        tx_hash: normalizedTx,
                                        amount_usdc: paymentLink.amount_usdc.toString()
                                    }
                                });

                            /* Complete idempotency key */
                            const successPayload = { success: true, message: "Payment verified and settled", paymentId: newPayment.id };
                            if (!isCctp && isReceiptId(receiptId)) {
                                const shareUrl = receiptUrl(receiptId, request.headers.get("origin"));
                                await supabase
                                    .from("receipts")
                                    .upsert({
                                        receipt_id: receiptId,
                                        payment_link_id: paymentLink.id,
                                        payment_link_payment_id: newPayment.id,
                                        tx_hash: normalizedTx,
                                        chain_id: Number(chainId),
                                        memo_contract: SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
                                        payer_address: normalizedPayer,
                                        merchant_address: paymentLink.merchant_address.toLowerCase(),
                                        amount_usdc: paymentLink.amount_usdc.toString(),
                                        memo_note: receiptId,
                                        share_url: shareUrl,
                                        status: "CONFIRMED",
                                        block_number: receipt.blockNumber.toString(),
                                        confirmed_at: new Date().toISOString(),
                                        updated_at: new Date().toISOString()
                                    }, { onConflict: "receipt_id" });

                                Object.assign(successPayload, { receiptId, shareUrl });
                            }

                            const { data: payerSettings } = await supabase
                                .from("customers")
                                .select("push_enabled, debit_success_enabled")
                                .eq("wallet_address", normalizedPayer)
                                .maybeSingle();

                            if (payerSettings?.push_enabled !== false && payerSettings?.debit_success_enabled !== false) {
                                await supabase
                                    .from("subscript_dms")
                                    .insert({
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
                                            !isCctp && isReceiptId(receiptId) ? `Receipt: ${receiptUrl(receiptId, request.headers.get("origin"))}` : null,
                                        ].filter(Boolean).join("\n"),
                                        tx_hash: normalizedTx,
                                        payment_link_id: paymentLink.id,
                                    });
                            }

                            if (!isCctp && isReceiptId(receiptId)) {
                                await sendPaymentReceiptEmails({
                                    amountUsdc: paymentLink.amount_usdc,
                                    receiptUrl: receiptUrl(receiptId),
                                    receiptId,
                                    merchantAddress: paymentLink.merchant_address,
                                    payerAddress: normalizedPayer,
                                    paymentTitle: paymentLink.title,
                                    txHash: normalizedTx,
                                });
                            }

                            await supabase
                                .from("idempotency_keys")
                                .update({
                                    status: "COMPLETED",
                                    response_payload: successPayload,
                                    updated_at: new Date().toISOString()
                                })
                                .eq("execution_key", executionKey);

                            /* Dispatch webhooks */
                            const { data: endpoints } = await supabase
                                .from("webhook_endpoints")
                                .select("*")
                                .eq("wallet_address", paymentLink.merchant_address.toLowerCase())
                                .eq("active", true);

                            if (endpoints) {
                                const webhookPayload = createPaymentSucceededWebhook({
                                    paymentId: newPayment.id,
                                    checkoutSessionId: paymentLink.id,
                                    merchantReference: paymentLink.external_reference || null,
                                    amountUsdc: paymentLink.amount_usdc,
                                    receiptId: !isCctp && isReceiptId(receiptId) ? receiptId : null,
                                    txHash: normalizedTx,
                                });
                                for (const endpoint of endpoints) {
                                    sendWebhookRequest(endpoint.url, webhookPayload, endpoint.secret).catch(() => {});
                                }
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

                /* Transition ledger entry to FAILED */
                await supabase
                    .from("ledger_entries")
                    .update({ status: "FAILED" })
                    .eq("tx_hash", normalizedTx);

                /* Update transaction status to FAILED */
                await supabase
                    .from("transaction_verifications")
                    .update({
                        status: "FAILED",
                        error_message: jobErr.message,
                        updated_at: new Date().toISOString()
                    })
                    .eq("tx_hash", normalizedTx);

                /* Remove or fail idempotency key to allow retries */
                await supabase.from("idempotency_keys").delete().eq("execution_key", executionKey);
            }
        })();

        return NextResponse.json({
            success: true,
            message: "Transaction verification submitted",
            status: "SUBMITTED"
        }, { status: 202 });

    } catch (error: any) {
        console.error("Verification POST error:", error);
        if (supabase && executionKey) {
            await supabase.from("idempotency_keys").delete().eq("execution_key", executionKey);
        }
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
