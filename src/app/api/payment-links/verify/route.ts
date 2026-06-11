import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { ProtocolConfig } from "@/lib/payments/config";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { addressToBuffer } from "@/lib/payments/address";
import { sendWebhookRequest } from "@/lib/webhooks";
import { CCTP_CONFIG, ARC_CCTP_DOMAIN_ID, SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";

const ERC20_INTERFACE = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const CCTP_MESSENGER_INTERFACE = new ethers.Interface([
    "event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)"
]);

const CCTP_RPCS: Record<number, string[]> = {
    1: ["https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"],
    8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    11155111: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.ankr.com/eth_sepolia"],
    84532: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"]
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

        const { txHash, paymentLinkId, payerAddress, chainId: bodyChainId } = body;
        const chainId = bodyChainId ? Number(bodyChainId) : ProtocolConfig.CHAIN_ID;
        const isCctp = [1, 8453, 11155111, 84532].includes(Number(chainId));

        if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid txHash" }, { status: 400 });
        }

        if (!paymentLinkId || typeof paymentLinkId !== "string") {
            return NextResponse.json({ error: "Bad Request: Missing or invalid paymentLinkId" }, { status: 400 });
        }

        if (!payerAddress || typeof payerAddress !== "string" || !ethers.isAddress(payerAddress)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid payerAddress" }, { status: 400 });
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

                                if (!nativeTx.to || nativeTx.to.toLowerCase() !== ProtocolConfig.USDC_ADDRESS.toLowerCase()) {
                                    throw new Error("Target contract is not USDC token");
                                }

                                /* Verify log event transfer to router address */
                                let logFound = false;
                                for (const log of receipt.logs) {
                                    if (log.address.toLowerCase() !== ProtocolConfig.USDC_ADDRESS.toLowerCase()) continue;
                                    try {
                                        const parsed = ERC20_INTERFACE.parseLog({
                                            topics: log.topics,
                                            data: log.data
                                        });
                                        if (
                                            parsed &&
                                            parsed.name === "Transfer" &&
                                            parsed.args.from.toLowerCase() === normalizedPayer &&
                                            parsed.args.to.toLowerCase() === ProtocolConfig.ROUTER_ADDRESS.toLowerCase() &&
                                            BigInt(parsed.args.value) === BigInt(paymentLink.amount_usdc)
                                        ) {
                                            logFound = true;
                                            break;
                                        }
                                    } catch {
                                        /* ignore */
                                    }
                                }

                                if (!logFound) {
                                    throw new Error("USDC Transfer event to Router not found");
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
                                for (const endpoint of endpoints) {
                                    sendWebhookRequest(endpoint.url, { event: "payment_link.payment_received", data: successPayload }, endpoint.secret).catch(() => {});
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
