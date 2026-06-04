import { ethers } from "ethers";
import { lockPaymentSession } from "./sessionLock";
import { verifyTransaction } from "./verifyTransaction";
import { activateSubscription } from "./activateSubscription";
import { ARC_TESTNET_CHAIN_ID } from "./constants";
import { executeWithRpcFallback } from "./rpc";

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

export async function processPremiumUpgrade({
    supabase,
    txHash,
    sessionId,
    walletAddress,
    isReconciler = false,
    requestId = "unknown"
}: {
    supabase: any;
    txHash: string;
    sessionId: string;
    walletAddress: string;
    isReconciler?: boolean;
    requestId?: string;
}): Promise<{ success: boolean; error?: string; status: number; tier?: number; upgradeTxHash?: string | null; message?: string }> {
    const normalizedUser = normalizeAddress(walletAddress);

    let session;
    if (isReconciler) {
        console.log(`[Premium Upgrade Started] Reconciler bypass active. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
        const { data, error } = await supabase
            .from("payment_sessions")
            .select("*")
            .eq("session_id", sessionId)
            .maybeSingle();

        if (error || !data) {
            console.error(`[Premium Upgrade Failed] Session fetch failed for reconciler: ${error?.message || "Not found"}. requestId: ${requestId}`);
            return { success: false, status: 404, error: "Checkout session not found." };
        }
        session = data;
    } else {
        console.log(`[Premium Upgrade Started] Acquiring lock. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
        const sessionRes = await lockPaymentSession(supabase, sessionId, txHash);
        
        if (sessionRes.error) {
            if (sessionRes.error.code === "23505") {
                console.error(`[Premium Upgrade Failed] Duplicate tx hash detected. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
                
                const { data: currentSession } = await supabase
                    .from("payment_sessions")
                    .select("processing_attempts")
                    .eq("session_id", sessionId)
                    .maybeSingle();

                const currentAttempts = currentSession?.processing_attempts || 0;
                const newAttempts = currentAttempts + 1;
                const isPermanent = newAttempts >= 5;

                await supabase
                    .from("payment_sessions")
                    .update({
                        status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                        processing_attempts: newAttempts,
                        last_error: "Transaction hash has already been processed by another session.",
                        failure_code: "DUPLICATE_TX",
                        updated_at: new Date().toISOString()
                    })
                    .eq("session_id", sessionId);

                return {
                    success: false,
                    status: 400,
                    error: "Transaction hash has already been processed by another session."
                };
            }
            console.error(`[Premium Upgrade Failed] lockPaymentSession failed: ${sessionRes.error.message}, requestId: ${requestId}`);
            return { success: false, status: 500, error: "Database error during lock acquisition." };
        }

        if (!sessionRes.data) {
            const { data: currentSession, error: fetchErr } = await supabase
                .from("payment_sessions")
                .select("*")
                .eq("session_id", sessionId)
                .maybeSingle();

            if (fetchErr) {
                console.error(`[Premium Upgrade Failed] Failed to fetch session state. requestId: ${requestId}, error: ${fetchErr.message}`);
                return { success: false, status: 500, error: "Database error retrieving session state." };
            }

            if (currentSession) {
                if (currentSession.status === "COMPLETED") {
                    console.log(`[Premium Upgrade Verified] Session ${sessionId} already completed. requestId: ${requestId}`);
                    return {
                        success: true,
                        status: 200,
                        tier: 1,
                        upgradeTxHash: null,
                        message: "Premium tier is already active."
                    };
                }
                if (currentSession.status === "PROCESSING") {
                    console.warn(`[Premium Upgrade Failed] Replay/concurrent process detected. requestId: ${requestId}`);
                    return {
                        success: false,
                        status: 409,
                        error: "Payment verification is already in progress. Please wait."
                    };
                }
                if (currentSession.status === "FAILED_PERMANENTLY") {
                    console.error(`[Premium Upgrade Failed] Session ${sessionId} is permanently failed. requestId: ${requestId}`);
                    return {
                        success: false,
                        status: 400,
                        error: "Checkout session has permanently failed due to retry exhaustion. Please contact support."
                    };
                }
                if (currentSession.status === "FAILED") {
                    console.error(`[Premium Upgrade Failed] Session ${sessionId} is marked FAILED. requestId: ${requestId}`);
                    return {
                        success: false,
                        status: 400,
                        error: "Checkout session has failed. Please create a new checkout session."
                    };
                }
            }
            return { success: false, status: 404, error: "Checkout session not found." };
        }
        session = sessionRes.data;
    }

    if (session.status === "COMPLETED") {
        console.log(`[Premium Upgrade Verified] Session already completed. requestId: ${requestId}`);
        return { success: true, status: 200, tier: 1, message: "Premium tier is already active." };
    }

    if (session.status === "FAILED_PERMANENTLY" || (session.processing_attempts || 0) >= 5) {
        console.error(`[Premium Upgrade Failed] Session has permanently failed. requestId: ${requestId}, attempts: ${session.processing_attempts}`);
        return { success: false, status: 400, error: "Checkout session has permanently failed." };
    }

    try {
        const sessionOwner = normalizeAddress(session.merchant_address);
        if (sessionOwner !== normalizedUser) {
            console.error(`[Premium Upgrade Failed] Authenticated address ${walletAddress} does not match session owner ${session.merchant_address}. requestId: ${requestId}`);
            
            await supabase
                .from("payment_sessions")
                .update({ tx_hash: null, status: "PENDING", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 403, error: "Session owner address mismatch." };
        }

        /* Check expiration - skip timeout check if a transaction hash exists */
        const nowMs = Date.now();
        const expiresMs = new Date(session.expires_at).getTime();
        if (nowMs > expiresMs && !txHash && !session.tx_hash) {
            console.error(`[Premium Upgrade Failed] Session ${sessionId} expired at ${session.expires_at}. requestId: ${requestId}`);
            await supabase
                .from("payment_sessions")
                .update({ status: "FAILED", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 400, error: "Checkout session has expired. Please start a new session." };
        }

        /* Circuit Breaker Check: Verify upgrades are active */
        if (process.env.ADMIN_UPGRADE_DISABLED === "true") {
            console.error(`[ALERT] Premium Upgrade Failed: ADMIN_UPGRADE_DISABLED circuit breaker is active. requestId: ${requestId}, sessionId: ${sessionId}`);
            await supabase
                .from("payment_sessions")
                .update({
                    status: "PENDING",
                    last_error: "Premium upgrades are temporarily paused by administrator.",
                    updated_at: new Date().toISOString()
                })
                .eq("session_id", sessionId);

            return {
                success: false,
                status: 503,
                error: "Service Unavailable: Premium upgrades are temporarily paused by administrator."
            };
        }

        /* 2. Connect to network and validate receipt metadata using RPC redundancy */
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            console.error("[Premium Upgrade Failed] Admin private key configuration missing on server. requestId:", requestId);
            throw new Error("Admin private key configuration missing on server.");
        }

        const { result: verificationResult, rpcEndpoint } = await executeWithRpcFallback(async (provider) => {
            const network = await provider.getNetwork();
            if (network.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
                console.error(`[tx_invalid_chain] RPC network chain ID mismatch. Expected ${ARC_TESTNET_CHAIN_ID}, got ${network.chainId}`);
                throw new Error("INVALID_CHAIN");
            }

            const [tx, receipt] = await Promise.all([
                provider.getTransaction(txHash),
                provider.getTransactionReceipt(txHash)
            ]);

            if (!tx || !receipt) {
                return { isPendingReceipt: true, valid: false, error: "Receipt not found yet.", provider };
            }

            const verification = await verifyTransaction(tx, receipt, session, provider);
            return { isPendingReceipt: false, valid: verification.valid, error: verification.error, provider, tx, receipt };
        });

        if (verificationResult.isPendingReceipt) {
            console.warn(`[Premium Upgrade Failed] Transaction receipt not indexed yet for hash: ${txHash}. requestId: ${requestId}`);
            
            await supabase
                .from("payment_sessions")
                .update({ tx_hash: null, status: "PENDING", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 404, error: "Transaction receipt not found. Please try again in a few seconds." };
        }

        if (!verificationResult.valid) {
            console.error(`[Premium Upgrade Failed] Transaction validation failed: ${verificationResult.error}. requestId: ${requestId}`);
            
            const newAttempts = (session.processing_attempts || 0) + 1;
            const isPermanent = newAttempts >= 5;
            
            await supabase
                .from("payment_sessions")
                .update({
                    status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                    processing_attempts: newAttempts,
                    last_error: verificationResult.error || "Payment verification failed.",
                    failure_code: "VERIFICATION_FAILED",
                    updated_at: new Date().toISOString()
                })
                .eq("session_id", sessionId);

            return { success: false, status: 400, error: verificationResult.error || "Payment verification failed." };
        }

        // Revalidate Ownership: verify transaction sender matches session owner and authenticated walletAddress
        const txSender = normalizeAddress(verificationResult.tx!.from);
        if (txSender !== sessionOwner || txSender !== normalizedUser) {
            console.error(`[Premium Upgrade Failed] Transaction sender ${txSender} does not match session owner ${sessionOwner} or auth user ${normalizedUser}. requestId: ${requestId}`);
            
            await supabase
                .from("payment_sessions")
                .update({ tx_hash: null, status: "PENDING", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 403, error: "Transaction sender does not match session owner." };
        }

        // On-Chain Confirmation Depth Check (Configurable)
        const minConfirmations = Number(process.env.PREMIUM_MIN_CONFIRMATIONS || "3");
        const currentBlock = await verificationResult.provider.getBlockNumber();
        const confirmations = currentBlock - verificationResult.receipt!.blockNumber + 1;

        if (confirmations < minConfirmations) {
            console.log(`[Premium Upgrade Failed] Pending block confirmations (${confirmations}/${minConfirmations}). requestId: ${requestId}, sessionId: ${sessionId}`);
            
            await supabase
                .from("payment_sessions")
                .update({
                    status: "PENDING",
                    updated_at: new Date().toISOString()
                })
                .eq("session_id", sessionId);

            return {
                success: false,
                status: 202,
                error: "PAYMENT_PENDING_CONFIRMATIONS"
            };
        }

        // Expiration Enforcement vs Block Timestamp
        const block = await verificationResult.provider.getBlock(verificationResult.receipt!.blockNumber);
        const blockTimestampMs = block ? block.timestamp * 1000 : 0;
        if (blockTimestampMs > expiresMs) {
            console.error(`[Premium Upgrade Failed] Transaction block timestamp ${blockTimestampMs} is after session expiration ${expiresMs}. requestId: ${requestId}`);
            
            const newAttempts = (session.processing_attempts || 0) + 1;
            const isPermanent = newAttempts >= 5;

            await supabase
                .from("payment_sessions")
                .update({
                    status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                    processing_attempts: newAttempts,
                    last_error: "Transaction was mined after the payment session expired.",
                    failure_code: "EXPIRED_TRANSACTION",
                    updated_at: new Date().toISOString()
                })
                .eq("session_id", sessionId);

            return { success: false, status: 400, error: "Transaction was mined after the payment session expired." };
        }

        console.log(`[Premium Upgrade Verified] Transaction verified and fully confirmed. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);

        /* 3. Idempotency Check: Save transaction globally in webhook_events */
        const { error: lockError } = await supabase
            .from("webhook_events")
            .insert({
                tx_hash: txHash.toLowerCase(),
                event_type: "premium_upgrade",
                payload: {
                    wallet_address: normalizedUser,
                    session_id: sessionId,
                    timestamp: new Date().toISOString()
                }
            });

        if (lockError) {
            if (lockError.code === "23505") {
                console.error(`[Premium Upgrade Failed] Global duplicate tx hash. requestId: ${requestId}, tx: ${txHash}`);
                
                const newAttempts = (session.processing_attempts || 0) + 1;
                const isPermanent = newAttempts >= 5;
                
                await supabase
                    .from("payment_sessions")
                    .update({
                        status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                        processing_attempts: newAttempts,
                        last_error: "Transaction hash has already been processed globally.",
                        failure_code: "DUPLICATE_TX",
                        updated_at: new Date().toISOString()
                    })
                    .eq("session_id", sessionId);

                return { success: false, status: 400, error: "Transaction has already been processed by another session." };
            }
            console.error(`[Premium Upgrade Failed] Failed to record idempotency lock: ${lockError.message}`);
            throw lockError;
        }

        /* 4. Activate premium subscription */
        const provider = verificationResult.provider;
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        
        await activateSubscription({
            supabase,
            merchantAddress: normalizedUser,
            txHash,
            adminWallet,
            sessionId,
            rpcEndpoint,
            requestId
        });

        console.log(`[Premium Upgrade Activated] Success. requestId: ${requestId}, merchant: ${normalizedUser}`);

        return {
            success: true,
            status: 200,
            tier: 1,
            upgradeTxHash: null
        };

    } catch (error: any) {
        console.error(`[Premium Upgrade Failed] Execution failure in processPremiumUpgrade:`, error);
        
        const newAttempts = (session.processing_attempts || 0) + 1;
        const isPermanent = newAttempts >= 5;
        
        let failureCode = "UNKNOWN_ERROR";
        if (error.message === "INVALID_CHAIN") {
            failureCode = "INVALID_CHAIN";
        } else if (error.message.includes("reverted") || error.message.includes("revert")) {
            failureCode = "CONTRACT_REVERT";
        } else if (error.message.includes("timeout") || error.message.includes("RPC") || error.message.includes("failover")) {
            failureCode = "RPC_TIMEOUT";
        }

        await supabase
            .from("payment_sessions")
            .update({
                status: isPermanent ? "FAILED_PERMANENTLY" : "PENDING",
                processing_attempts: newAttempts,
                last_error: error.message || "Internal Server Error",
                failure_code: failureCode,
                updated_at: new Date().toISOString()
            })
            .eq("session_id", sessionId);

        if (isPermanent) {
            console.error(`[ALERT] FAILED_PERMANENTLY checkout session: ${sessionId}, reason: ${failureCode}, requestId: ${requestId}`);
        }

        return { success: false, status: 500, error: error.message || "Internal Server Error" };
    }
}
