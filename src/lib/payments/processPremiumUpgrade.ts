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
    walletAddress
}: {
    supabase: any;
    txHash: string;
    sessionId: string;
    walletAddress: string;
}): Promise<{ success: boolean; error?: string; status: number; tier?: number; upgradeTxHash?: string | null; message?: string }> {
    console.log(`[tx_received] Processing premium upgrade for merchant: ${walletAddress}, session: ${sessionId}, tx: ${txHash}`);

    /* 1. Acquire atomic database-level session lock */
    const sessionRes = await lockPaymentSession(supabase, sessionId, txHash);
    
    if (!sessionRes.data) {
        /* Lock acquisition failed; check the current session status for structured handling */
        const { data: currentSession, error: fetchErr } = await supabase
            .from("payment_sessions")
            .select("*")
            .eq("session_id", sessionId)
            .maybeSingle();

        if (fetchErr) {
            console.error(`[db_updated] Failed to fetch session state: ${fetchErr.message}`);
            return { success: false, status: 500, error: "Database error retrieving session state." };
        }

        if (currentSession) {
            if (currentSession.status === "COMPLETED") {
                console.log(`[activation_skipped] Session ${sessionId} already completed.`);
                return {
                    success: true,
                    status: 200,
                    tier: 1,
                    upgradeTxHash: null,
                    message: "Premium tier is already active."
                };
            }
            if (currentSession.status === "PROCESSING") {
                console.warn(`[replay_detected] Session ${sessionId} is currently processing elsewhere.`);
                return {
                    success: false,
                    status: 409,
                    error: "Payment verification is already in progress. Please wait."
                };
            }
            if (currentSession.status === "FAILED_PERMANENTLY") {
                console.error(`[verification_blocked] Session ${sessionId} is permanently failed.`);
                return {
                    success: false,
                    status: 400,
                    error: "Checkout session has permanently failed due to retry exhaustion. Please contact support."
                };
            }
            if (currentSession.status === "FAILED") {
                console.error(`[replay_detected] Upgrade failed because session ${sessionId} is marked FAILED.`);
                return {
                    success: false,
                    status: 400,
                    error: "Checkout session has failed. Please create a new checkout session."
                };
            }
        }
        return { success: false, status: 404, error: "Checkout session not found." };
    }

    const session = sessionRes.data;

    if (session.status === "FAILED_PERMANENTLY" || (session.processing_attempts || 0) >= 5) {
        console.error(`[replay_blocked] Checkout session ${sessionId} has permanently failed.`);
        return { success: false, status: 400, error: "Checkout session has permanently failed." };
    }

    try {
        const normalizedUser = normalizeAddress(walletAddress);
        /* Verify session identity match */
        if (normalizeAddress(session.merchant_address) !== normalizedUser) {
            console.error(`[replay_detected] Authenticated address ${walletAddress} does not match session owner ${session.merchant_address}`);
            
            /* Reset session back to PENDING to allow the correct owner to pay */
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
            console.error(`[session_expired] Session ${sessionId} expired at ${session.expires_at}`);
            await supabase
                .from("payment_sessions")
                .update({ status: "FAILED", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 400, error: "Checkout session has expired. Please start a new session." };
        }

        /* 2. Connect to network and validate receipt metadata using RPC redundancy */
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            console.error("[db_updated] Admin private key configuration missing on server.");
            throw new Error("Admin private key configuration missing on server.");
        }

        const verificationResult = await executeWithRpcFallback(async (provider) => {
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
            return { isPendingReceipt: false, valid: verification.valid, error: verification.error, provider };
        });

        if (verificationResult.isPendingReceipt) {
            console.warn(`[tx_failed_verification] Transaction receipt not indexed yet for hash: ${txHash}`);
            
            /* Release lock back to PENDING so verification can be retried */
            await supabase
                .from("payment_sessions")
                .update({ tx_hash: null, status: "PENDING", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId);

            return { success: false, status: 404, error: "Transaction receipt not found. Please try again in a few seconds." };
        }

        if (!verificationResult.valid) {
            console.error(`[tx_failed_verification] Transaction validation failed: ${verificationResult.error}`);
            
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

            /* Observability metric log */
            console.log(`[metric] checkout_sessions_failed: ${sessionId}, attempts: ${newAttempts}, reason: VERIFICATION_FAILED`);
            if (isPermanent) {
                console.error(`[ALERT] FAILED_PERMANENTLY checkout session: ${sessionId}, reason: VERIFICATION_FAILED`);
            }

            return { success: false, status: 400, error: verificationResult.error || "Payment verification failed." };
        }

        console.log(`[tx_verified] Transaction verified successfully. Event logs validated.`);

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
            if (lockError.code === "23505") { /* unique_violation */
                console.error(`[duplicate_tx] Transaction ${txHash} has already been processed globally.`);
                
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
            console.error(`[db_updated] Failed to record idempotency lock: ${lockError.message}`);
            throw lockError;
        }

        /* 4. Activate premium subscription and mark COMPLETED */
        const provider = verificationResult.provider;
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        await activateSubscription({
            supabase,
            merchantAddress: normalizedUser,
            txHash,
            adminWallet,
            sessionId
        });

        /* Structured observability metric log */
        console.log(`[metric] checkout_sessions_completed: ${sessionId}, merchant: ${normalizedUser}`);

        return {
            success: true,
            status: 200,
            tier: 1,
            upgradeTxHash: null
        };

    } catch (error: any) {
        console.error(`[db_updated] Execution failure in processPremiumUpgrade:`, error);
        
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

        /* Metric log */
        console.log(`[metric] checkout_sessions_failed: ${sessionId}, attempts: ${newAttempts}, reason: ${failureCode}`);
        if (isPermanent) {
            console.error(`[ALERT] FAILED_PERMANENTLY checkout session: ${sessionId}, reason: ${failureCode}`);
        }

        return { success: false, status: 500, error: error.message || "Internal Server Error" };
    }
}
