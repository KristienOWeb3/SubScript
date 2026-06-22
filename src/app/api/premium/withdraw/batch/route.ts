import { NextResponse, after } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { ProtocolConfig } from "@/lib/payments/config";
import { executeWithRpcFallback, getRpcProviderForWrite } from "@/lib/payments/rpc";
import { repairMerchantBalance } from "@/lib/payments/repairBalances";
import { addressToBuffer } from "@/lib/payments/address";
import { CONFIDENTIAL_CONTRACT_ADDRESS } from "@/lib/contracts/constants";

const USDC_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
];

const ROUTER_ABI = [
    "function executeBatchPayout(address[] calldata recipients, uint256[] calldata amounts) external"
];

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
    let merchantAddress = "";

    try {
        merchantAddress = await getSessionWallet(request.headers) || "";
        if (!merchantAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet" }, { status: 401 });
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON" }, { status: 400 });
        }

        const { recipients, idempotencyKey, viewKey } = body;

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return NextResponse.json({ error: "Bad Request: Recipients list must be a non-empty array" }, { status: 400 });
        }

        if (!idempotencyKey || typeof idempotencyKey !== "string") {
            return NextResponse.json({ error: "Bad Request: Missing or invalid idempotencyKey" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Enforce Idempotency */
        executionKey = `batch-payout:${idempotencyKey.toLowerCase()}`;
        const { data: existingKey } = await supabase
            .from("idempotency_keys")
            .select("*")
            .eq("execution_key", executionKey)
            .maybeSingle();

        if (existingKey) {
            if (existingKey.status === "PROCESSING") {
                return NextResponse.json({ error: "Conflict: Batch payout execution in progress" }, { status: 409 });
            }
            if (existingKey.status === "COMPLETED") {
                return NextResponse.json(existingKey.response_payload, { status: 200 });
            }
        }

        /* Check circuit breakers */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("batch_payouts_enabled")
            .maybeSingle();

        if (settings && settings.batch_payouts_enabled === false) {
            return NextResponse.json({ error: "Service Unavailable: Batch payouts are temporarily disabled." }, { status: 503 });
        }

        /* Check merchant details including tier and confidentiality settings */
        const { data: merchant, error: merchError } = await supabase
            .from("merchants")
            .select("tier, shielded_payouts_enabled, view_key_hash")
            .eq("wallet_address", merchantAddress.toLowerCase())
            .maybeSingle();

        if (merchError || !merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Premium merchant tier required for batch payouts" }, { status: 403 });
        }

        const isShielded = !!merchant.shielded_payouts_enabled;
        if (isShielded) {
            /* Fail closed: a merchant marked confidential but without a registered view key must NOT
               be silently downgraded to a public payout. Block and prompt them to finish setup. */
            if (!merchant.view_key_hash) {
                return NextResponse.json({ error: "Confidential payouts are enabled but no view key is registered. Register a view key before sending a shielded payout." }, { status: 409 });
            }
            if (!viewKey || typeof viewKey !== "string") {
                return NextResponse.json({ error: "Bad Request: viewKey is required for shielded payouts" }, { status: 400 });
            }
            const calculatedHash = ethers.keccak256(viewKey);
            if (calculatedHash.toLowerCase() !== merchant.view_key_hash?.toLowerCase()) {
                return NextResponse.json({ error: "Forbidden: Invalid viewKey provided" }, { status: 403 });
            }
        }

        /* Create idempotency key in processing state */
        const expiresAt = new Date(Date.now() + ProtocolConfig.IDEMPOTENCY_TTL * 1000).toISOString();
        await supabase
            .from("idempotency_keys")
            .insert({
                execution_key: executionKey,
                status: "PROCESSING",
                expires_at: expiresAt,
                response_payload: null
            });

        /* Validate recipients list and calculate total amount */
        if (recipients.length > ProtocolConfig.MAX_BATCH_RECIPIENTS) {
            throw new Error(`Economic limit exceeded: Max recipients is ${ProtocolConfig.MAX_BATCH_RECIPIENTS}`);
        }

        let totalBatchAmount = BigInt(0);
        const validatedRecipients = [];

        for (const item of recipients) {
            const { address, amount } = item;
            if (!address || typeof address !== "string" || !ethers.isAddress(address)) {
                throw new Error(`Invalid recipient address format: ${address}`);
            }

            let amountBigInt: bigint;
            try {
                amountBigInt = BigInt(amount);
                if (amountBigInt <= BigInt(0)) {
                    throw new Error(`Amount must be positive: ${amount}`);
                }
                if (amountBigInt > ProtocolConfig.MAX_SINGLE_RECIPIENT_AMOUNT) {
                    throw new Error(`Single recipient limit exceeded for ${address}: ${amount}`);
                }
            } catch (e: any) {
                throw new Error(`Invalid amount format: ${amount}. ${e.message}`);
            }

            totalBatchAmount += amountBigInt;
            validatedRecipients.push({
                address: address.toLowerCase(),
                amount: amountBigInt
            });
        }

        if (totalBatchAmount > ProtocolConfig.MAX_BATCH_AMOUNT) {
            throw new Error(`Economic limit exceeded: Max batch total is ${totalBatchAmount / BigInt(1000000)} USDC`);
        }

        /* Database Row Locking & Spendable Balance Verification */
        const { error: lockError } = await supabase.rpc("lock_merchant_row", {
            p_wallet_address: merchantAddress.toLowerCase()
        });

        if (lockError) {
            console.error("Row lock acquisition failed for batch payout:", lockError.message);
        }

        /* Ensure balance cache is up-to-date prior to checking funds */
        await repairMerchantBalance(supabase, merchantAddress.toLowerCase());

        /* Retrieve from the Spendable Balance derived view as the primary source of truth */
        const { data: balanceData } = await supabase
            .from("merchant_spendable_balances")
            .select("spendable_balance")
            .eq("wallet_address", merchantAddress.toLowerCase())
            .single();

        const spendableBalance = BigInt(balanceData?.spendable_balance || "0");

        if (spendableBalance < totalBatchAmount) {
            throw new Error(`Insufficient funds: Spendable balance is ${spendableBalance} micro-USDC, batch requires ${totalBatchAmount}`);
        }

        /* Create batch record in PENDING status */
        const { data: batch, error: batchError } = await supabase
            .from("payout_batches")
            .insert({
                merchant_address: merchantAddress.toLowerCase(),
                status: "PENDING",
                recipient_count: validatedRecipients.length,
                total_amount_usdc: totalBatchAmount.toString()
            })
            .select()
            .single();

        if (batchError || !batch) {
            throw new Error(`Failed to initialize payout batch: ${batchError?.message}`);
        }

        /* Reserve balance in ledger entries using bytea conversion in PENDING state (Phase 1) */
        const merchantBuf = addressToBuffer(merchantAddress);
        const { data: reserveEntry, error: reserveError } = await supabase
            .from("ledger_entries")
            .insert({
                merchant_address: merchantBuf,
                entry_type: "RESERVE",
                status: "PENDING",
                amount_usdc: totalBatchAmount.toString(),
                reference_type: "BATCH_PAYOUT",
                reference_id: batch.id
            })
            .select()
            .single();

        if (reserveError || !reserveEntry) {
            throw new Error(`Failed to reserve balance in ledger: ${reserveError?.message}`);
        }

        /* Refresh balance cache to reflect reservation */
        await repairMerchantBalance(supabase, merchantAddress.toLowerCase());

        /* Insert payout batch items in PENDING state */
        const batchItemsToInsert = validatedRecipients.map((item: any) => ({
            batch_id: batch.id,
            recipient_address: item.address,
            amount_usdc: item.amount.toString(),
            status: "PENDING"
        }));

        const { data: insertedItems, error: itemsError } = await supabase
            .from("payout_batch_items")
            .insert(batchItemsToInsert)
            .select();

        if (itemsError || !insertedItems) {
            throw new Error(`Failed to insert batch items: ${itemsError?.message}`);
        }

        /* Spawn the async payout job in the background (Non-Blocking Phase 2).
           Registered with after() so the serverless runtime keeps the instance alive until the
           on-chain payout + ledger finalization completes. A bare fire-and-forget IIFE could be
           frozen/terminated right after the 202, leaving batches stuck PROCESSING and the
           merchant's reserved balance permanently locked. */
        const payoutJob = (async () => {
            try {
                /* Update batch status to PROCESSING */
                await supabase
                    .from("payout_batches")
                    .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
                    .eq("id", batch.id);

                const adminPrivateKey = process.env.PRIVATE_KEY;
                const chunkSize = 100;
                let successfulCount = 0;
                let successfulAmount = BigInt(0);
                let failedCount = 0;
                let failedAmount = BigInt(0);

                for (let i = 0; i < insertedItems.length; i += chunkSize) {
                    const chunkItems = insertedItems.slice(i, i + chunkSize);
                    const chunkIndex = Math.floor(i / chunkSize);

                    /* Create chunk record */
                    const chunkTotal = chunkItems.reduce((acc: bigint, item: any) => acc + BigInt(item.amount_usdc), BigInt(0));
                    const { data: chunk, error: chunkError } = await supabase
                        .from("payout_batch_chunks")
                        .insert({
                            batch_id: batch.id,
                            chunk_index: chunkIndex,
                            status: "PROCESSING",
                            recipient_count: chunkItems.length,
                            total_amount: chunkTotal.toString()
                        })
                        .select()
                        .single();

                    if (chunkError || !chunk) {
                        console.error("Failed to create chunk record:", chunkError?.message);
                        continue;
                    }

                    /* Map items to chunk */
                    await supabase
                        .from("payout_batch_items")
                        .update({ chunk_id: chunk.id, status: "PROCESSING" })
                        .in("id", chunkItems.map((item: any) => item.id));

                    let chunkTxHash: string | null = null;
                    let chunkFailed = false;
                    let chunkErrorMessage = "";

                    try {
                        if (!adminPrivateKey) {
                            throw new Error("PRIVATE_KEY not configured on server");
                        }

                        const { provider, rpcEndpoint } = await getRpcProviderForWrite();
                        const wallet = new ethers.Wallet(adminPrivateKey, provider);
                        const usdcContract = new ethers.Contract(ProtocolConfig.USDC_ADDRESS, USDC_ABI, wallet);

                        const spenderAddress = isShielded
                            ? CONFIDENTIAL_CONTRACT_ADDRESS
                            : ProtocolConfig.ROUTER_ADDRESS;

                        /* Check and approve USDC allowance if necessary */
                        const allowance = await usdcContract.allowance(wallet.address, spenderAddress);
                        if (allowance < chunkTotal) {
                            const approveTx = await usdcContract.approve(spenderAddress, ethers.MaxUint256);
                            await approveTx.wait();
                        }

                        let txHash: string;
                        if (isShielded) {
                            const confidentialContract = new ethers.Contract(
                                spenderAddress,
                                [
                                    "function executeBatchPayout(address[] calldata recipients, uint256[] calldata amounts, bool isShielded, bytes32 viewKey) external"
                                ],
                                wallet
                            );

                            /* Ensure viewKey is padded to bytes32 format */
                            const formattedViewKey = ethers.zeroPadValue(viewKey || ethers.ZeroHash, 32);

                            await confidentialContract.executeBatchPayout.staticCall(
                                chunkItems.map((item: any) => item.recipient_address),
                                chunkItems.map((item: any) => BigInt(item.amount_usdc)),
                                true,
                                formattedViewKey
                            );

                            const tx = await confidentialContract.executeBatchPayout(
                                chunkItems.map((item: any) => item.recipient_address),
                                chunkItems.map((item: any) => BigInt(item.amount_usdc)),
                                true,
                                formattedViewKey
                            );
                            txHash = tx.hash;
                        } else {
                            const routerContract = new ethers.Contract(spenderAddress, ROUTER_ABI, wallet);

                            await routerContract.executeBatchPayout.staticCall(
                                chunkItems.map((item: any) => item.recipient_address),
                                chunkItems.map((item: any) => BigInt(item.amount_usdc))
                            );

                            const tx = await routerContract.executeBatchPayout(
                                chunkItems.map((item: any) => item.recipient_address),
                                chunkItems.map((item: any) => BigInt(item.amount_usdc))
                            );
                            txHash = tx.hash;
                        }
                        console.log(`[batch-payout] submitted chunk ${chunk.id} through ${rpcEndpoint}: ${txHash}`);
                        chunkTxHash = txHash;

                        /* Register transaction verification in SUBMITTED state */
                        await supabase
                            .from("transaction_verifications")
                            .upsert({
                                tx_hash: txHash.toLowerCase(),
                                status: "SUBMITTED",
                                reference_type: "BATCH_PAYOUT_CHUNK",
                                reference_id: chunk.id,
                                confirmations: 0,
                                updated_at: new Date().toISOString()
                            });

                        /* Update chunk with transaction hash */
                        await supabase
                            .from("payout_batch_chunks")
                            .update({ tx_hash: txHash })
                            .eq("id", chunk.id);

                        /* Wait for confirmations */
                        let attempts = 0;
                        const maxAttempts = 15;
                        let confirmations = 0;
                        let confirmed = false;

                        while (attempts < maxAttempts) {
                            attempts++;
                            try {
                                const verifyResult = await executeWithRpcFallback(async (provider) => {
                                    const [receipt, currentBlock] = await Promise.all([
                                        provider.getTransactionReceipt(txHash),
                                        provider.getBlockNumber()
                                    ]);

                                    if (!receipt) {
                                        throw new Error("Transaction receipt not found yet");
                                    }

                                    const confs = currentBlock - receipt.blockNumber + 1;
                                    return { receipt, confs };
                                });

                                const receipt = verifyResult.result.receipt;
                                confirmations = Math.max(0, verifyResult.result.confs);

                                await supabase
                                    .from("transaction_verifications")
                                    .update({
                                        status: "PENDING_CONFIRMATIONS",
                                        confirmations,
                                        updated_at: new Date().toISOString()
                                    })
                                    .eq("tx_hash", txHash.toLowerCase());

                                if (confirmations >= ProtocolConfig.MIN_CONFIRMATIONS) {
                                    if (receipt.status !== 1) {
                                        throw new Error("Batch payout transaction reverted on-chain");
                                    }
                                    confirmed = true;
                                    break;
                                }
                            } catch (err: any) {
                                console.warn(`[payout-chunk-verify] Attempt ${attempts} failed: ${err.message}`);
                            }
                            await new Promise(res => setTimeout(res, 5000));
                        }

                        if (!confirmed) {
                            throw new Error("Verification timed out after max block polling attempts");
                        }

                        /* On success: Update chunk status to COMPLETED */
                        await supabase
                            .from("payout_batch_chunks")
                            .update({
                                status: "COMPLETED",
                                updated_at: new Date().toISOString()
                            })
                            .eq("id", chunk.id);

                        await supabase
                            .from("transaction_verifications")
                            .update({
                                status: "CONFIRMED",
                                updated_at: new Date().toISOString()
                            })
                            .eq("tx_hash", txHash.toLowerCase());

                        /* Mark items as completed and insert finalized debit ledger entries */
                        for (const item of chunkItems) {
                            await supabase
                                .from("payout_batch_items")
                                .update({ status: "COMPLETED", tx_hash: txHash })
                                .eq("id", item.id);

                            await supabase
                                .from("ledger_entries")
                                .insert({
                                    merchant_address: merchantBuf,
                                    entry_type: "DEBIT_BATCH_PAYOUT",
                                    status: "FINALIZED",
                                    amount_usdc: item.amount_usdc,
                                    reference_type: "BATCH_PAYOUT_ITEM",
                                    reference_id: item.id,
                                    tx_hash: txHash
                                });

                            successfulCount++;
                            successfulAmount += BigInt(item.amount_usdc);
                        }

                    } catch (txError: any) {
                        console.error(`Transaction failed for chunk index ${chunkIndex}:`, txError.message || txError);
                        chunkFailed = true;
                        chunkErrorMessage = txError.message || String(txError);

                        /* Mark chunk as failed */
                        await supabase
                            .from("payout_batch_chunks")
                            .update({
                                status: "FAILED",
                                updated_at: new Date().toISOString()
                            })
                            .eq("id", chunk.id);

                        if (chunkTxHash) {
                            await supabase
                                .from("transaction_verifications")
                                .update({
                                    status: "FAILED",
                                    error_message: chunkErrorMessage,
                                    updated_at: new Date().toISOString()
                                })
                                .eq("tx_hash", chunkTxHash.toLowerCase());
                        }

                        /* Mark items in chunk as failed */
                        for (const item of chunkItems) {
                            await supabase
                                .from("payout_batch_items")
                                .update({ status: "FAILED" })
                                .eq("id", item.id);

                            failedCount++;
                            failedAmount += BigInt(item.amount_usdc);
                        }
                    }
                }

                /* Update final batch status */
                const finalStatus = failedCount === 0 ? "COMPLETED" : (successfulCount > 0 ? "PARTIALLY_COMPLETED" : "FAILED");
                await supabase
                    .from("payout_batches")
                    .update({
                        status: finalStatus,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", batch.id);

                /* Release/invalidate the original RESERVE entry by marking it as FAILED */
                await supabase
                    .from("ledger_entries")
                    .update({ status: "FAILED" })
                    .eq("id", reserveEntry.id);

                /* Refresh balance cache to reflect final ledger states */
                await repairMerchantBalance(supabase, merchantAddress.toLowerCase());

                /* Log audit event */
                await supabase
                    .from("audit_events")
                    .insert({
                        actor: merchantAddress.toLowerCase(),
                        action: "BATCH_PAYOUT_COMPLETED",
                        resource_type: "BATCH_PAYOUT",
                        resource_id: batch.id,
                        metadata: {
                            total_amount_usdc: totalBatchAmount.toString(),
                            successful_count: successfulCount,
                            successful_amount: successfulAmount.toString(),
                            failed_count: failedCount,
                            failed_amount: failedAmount.toString(),
                            status: finalStatus
                        }
                    });

                const responsePayload = {
                    success: true,
                    batchId: batch.id,
                    status: finalStatus,
                    successfulCount,
                    successfulAmount: successfulAmount.toString(),
                    failedCount,
                    failedAmount: failedAmount.toString()
                };

                /* Save response payload in idempotency key */
                await supabase
                    .from("idempotency_keys")
                    .update({
                        status: "COMPLETED",
                        response_payload: responsePayload,
                        updated_at: new Date().toISOString()
                    })
                    .eq("execution_key", executionKey);

            } catch (jobErr: any) {
                console.error(`[batch-payout-job] Terminal background execution error:`, jobErr);

                /* Update final batch status to FAILED */
                await supabase
                    .from("payout_batches")
                    .update({
                        status: "FAILED",
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", batch.id);

                /* Release the original RESERVE entry */
                await supabase
                    .from("ledger_entries")
                    .update({ status: "FAILED" })
                    .eq("id", reserveEntry.id);

                /* Clean up idempotency key to allow retries */
                await supabase.from("idempotency_keys").delete().eq("execution_key", executionKey);

                await repairMerchantBalance(supabase, merchantAddress.toLowerCase());
            }
        })();

        after(payoutJob);

        return NextResponse.json({
            success: true,
            batchId: batch.id,
            status: "PENDING",
            message: "Batch payout processing initiated"
        }, { status: 202 });

    } catch (error: any) {
        console.error("Batch payout exception caught:", error);

        /* Fail/Clean up idempotency key if we encountered a check error before processing */
        if (supabase && executionKey) {
            await supabase.from("idempotency_keys").delete().eq("execution_key", executionKey);
        }

        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
