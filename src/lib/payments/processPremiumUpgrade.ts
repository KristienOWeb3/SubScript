import { ethers } from "ethers";
import crypto from "crypto";
import { verifyTransaction } from "./verifyTransaction";
import { activateSubscription } from "./activateSubscription";
import { ARC_TESTNET_CHAIN_ID } from "./constants";
import { executeWithRpcFallback } from "./rpc";

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const isRecoverableCustodySenderMismatch = (session: any, txHash: string) => {
    if (!["FAILED", "FAILED_PERMANENTLY"].includes(String(session?.status || ""))) return false;
    if (session?.failure_code !== "VERIFICATION_FAILED") return false;
    if (!session?.tx_hash || session.tx_hash.toLowerCase() !== txHash.toLowerCase()) return false;
    return /sender does not match session merchant|receipt sender does not match session merchant|transaction sender does not match session owner/i
        .test(String(session.last_error || ""));
};

export async function processPremiumUpgrade({
    supabase,
    txHash,
    sessionId,
    walletAddress,
    isReconciler = false,
    claimId,
    requestId = "unknown"
}: {
    supabase: any;
    txHash: string;
    sessionId: string;
    walletAddress: string;
    isReconciler?: boolean;
    claimId?: string;
    requestId?: string;
}): Promise<{ success: boolean; error?: string; status: number; tier?: number; upgradeTxHash?: string | null; message?: string }> {
    const normalizedUser = normalizeAddress(walletAddress);
    const processingClaimId = claimId || crypto.randomUUID();

    const updateOwnedSession = async (updates: Record<string, unknown>) => {
        const { data, error } = await supabase
            .from("payment_sessions")
            .update({
                ...updates,
                processing_claim_id: null,
                processing_started_at: null,
                updated_at: new Date().toISOString()
            })
            .eq("session_id", sessionId)
            .eq("status", "PROCESSING")
            .eq("processing_claim_id", processingClaimId)
            .select("session_id")
            .maybeSingle();

        if (error) {
            console.error(`[db_updated] Failed to update owned premium session ${sessionId}: ${error.message}`);
        }

        return Boolean(data);
    };

    let session;
    if (isReconciler) {
        if (!claimId) {
            console.error(`[Premium Upgrade Failed] Reconciler claim ID missing. requestId: ${requestId}, sessionId: ${sessionId}`);
            return { success: false, status: 500, error: "Reconciliation claim is missing." };
        }

        console.log(`[Premium Upgrade Started] Verifying reconciler claim. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
        const { data, error } = await supabase
            .from("payment_sessions")
            .select("*")
            .eq("session_id", sessionId)
            .eq("status", "PROCESSING")
            .eq("processing_claim_id", processingClaimId)
            .maybeSingle();

        if (error || !data) {
            const { data: currentSession } = await supabase
                .from("payment_sessions")
                .select("status")
                .eq("session_id", sessionId)
                .maybeSingle();

            if (currentSession?.status === "COMPLETED") {
                return { success: true, status: 200, tier: 1, message: "Premium tier is already active." };
            }

            console.error(`[Premium Upgrade Failed] Reconciliation claim is no longer owned. requestId: ${requestId}, sessionId: ${sessionId}, error: ${error?.message || "claim mismatch"}`);
            return { success: false, status: 409, error: "Reconciliation claim is no longer owned." };
        }
        session = data;
    } else {
        console.log(`[Premium Upgrade Started] Acquiring owned claim. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
        const sessionRes = await supabase
            .rpc("claim_premium_payment_session", {
                p_session_id: sessionId,
                p_tx_hash: txHash,
                p_claim_id: processingClaimId
            })
            .maybeSingle();

        if (sessionRes.error) {
            if (sessionRes.error.code === "23505") {
                console.error(`[Premium Upgrade Failed] Transaction hash belongs to another session. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
                return { success: false, status: 400, error: "Transaction has already been assigned to another session." };
            }

            console.error(`[Premium Upgrade Failed] Claim acquisition failed: ${sessionRes.error.message}, requestId: ${requestId}`);
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
                    if (isRecoverableCustodySenderMismatch(currentSession, txHash)) {
                        console.warn(`[Premium Upgrade Recovery] Revalidating false-negative custody sender mismatch requires a fresh database claim. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
                        return { success: false, status: 409, error: "Checkout session recovery could not be claimed. Please retry." };
                    }

                    console.error(`[Premium Upgrade Failed] Session ${sessionId} is permanently failed. requestId: ${requestId}`);
                    return {
                        success: false,
                        status: 400,
                        error: "Checkout session has permanently failed due to retry exhaustion. Please contact support."
                    };
                } else if (currentSession.status === "FAILED") {
                    console.error(`[Premium Upgrade Failed] Session ${sessionId} is marked FAILED. requestId: ${requestId}`);
                    return {
                        success: false,
                        status: 400,
                        error: "Checkout session has failed. Please create a new checkout session."
                    };
                }
                if (currentSession.tx_hash && currentSession.tx_hash.toLowerCase() !== txHash.toLowerCase()) {
                    return { success: false, status: 409, error: "Checkout session is already bound to another transaction." };
                }
            }
            return currentSession
                ? { success: false, status: 409, error: "Checkout session is not currently eligible for processing." }
                : { success: false, status: 404, error: "Checkout session not found." };
        } else {
            session = sessionRes.data;
        }
    }

    if (session.status === "COMPLETED") {
        console.log(`[Premium Upgrade Verified] Session already completed. requestId: ${requestId}`);
        return { success: true, status: 200, tier: 1, message: "Premium tier is already active." };
    }

    try {
        const sessionOwner = normalizeAddress(session.merchant_address);
        if (sessionOwner !== normalizedUser) {
            console.error(`[Premium Upgrade Failed] Authenticated address ${walletAddress} does not match session owner ${session.merchant_address}. requestId: ${requestId}`);
            
            await updateOwnedSession({ tx_hash: null, status: "PENDING" });

            return { success: false, status: 403, error: "Session owner address mismatch." };
        }

        /* Check expiration - skip timeout check if a transaction hash exists */
        const nowMs = Date.now();
        const expiresMs = new Date(session.expires_at).getTime();
        if (nowMs > expiresMs && !txHash && !session.tx_hash) {
            console.error(`[Premium Upgrade Failed] Session ${sessionId} expired at ${session.expires_at}. requestId: ${requestId}`);
            await updateOwnedSession({ status: "FAILED" });

            return { success: false, status: 400, error: "Checkout session has expired. Please start a new session." };
        }

        /* Circuit Breaker Check: Verify upgrades are active */
        if (process.env.ADMIN_UPGRADE_DISABLED === "true") {
            console.error(`[ALERT] Premium Upgrade Failed: ADMIN_UPGRADE_DISABLED circuit breaker is active. requestId: ${requestId}, sessionId: ${sessionId}`);
            await updateOwnedSession({
                status: "PENDING",
                last_error: "Premium upgrades are temporarily paused by administrator."
            });

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

            /* Reconciler re-processes sessions that were paid but stalled and can legitimately run
               days later, so it skips the 24h block-age bound. Replay stays impossible: the tx hash
               is globally single-use and block timestamp <= session expiry is still enforced. */
            const verification = await verifyTransaction(tx, receipt, session, provider, { allowAgedBlock: isReconciler });
            return {
                isPendingReceipt: false,
                valid: verification.valid,
                error: verification.error,
                subscriber: verification.subscriber,
                subId: verification.subId,
                provider,
                tx,
                receipt
            };
        });

        if (verificationResult.isPendingReceipt) {
            console.warn(`[Premium Upgrade Failed] Transaction receipt not indexed yet for hash: ${txHash}. requestId: ${requestId}`);
            
            await updateOwnedSession({ tx_hash: null, status: "PENDING" });

            return { success: false, status: 404, error: "Transaction receipt not found. Please try again in a few seconds." };
        }

        if (!verificationResult.valid) {
            console.error(`[Premium Upgrade Failed] Transaction validation failed: ${verificationResult.error}. requestId: ${requestId}`);

            /* Verification failures are deterministic for a given transaction hash. Retrying
               a tx that targeted the wrong contract only creates noisy keeper failures. */
            const newAttempts = (session.processing_attempts || 0) + 1;
            
            await updateOwnedSession({
                status: "FAILED_PERMANENTLY",
                processing_attempts: newAttempts,
                last_error: verificationResult.error || "Payment verification failed.",
                failure_code: "VERIFICATION_FAILED"
            });

            return { success: false, status: 400, error: verificationResult.error || "Payment verification failed." };
        }

        /* Revalidate Ownership: the contract-level subscriber must match the session owner and auth user.
           Custody-generated wallets may submit through an execution account, so tx.from is not the
           payer authority for premium activation. */
        const txSubscriber = verificationResult.subscriber ? normalizeAddress(verificationResult.subscriber) : "";
        if (txSubscriber !== sessionOwner || txSubscriber !== normalizedUser) {
            console.error(`[Premium Upgrade Failed] Transaction subscriber ${txSubscriber || "unknown"} does not match session owner ${sessionOwner} or auth user ${normalizedUser}. requestId: ${requestId}`);
            
            await updateOwnedSession({ tx_hash: null, status: "PENDING" });

            return { success: false, status: 403, error: "Transaction subscriber does not match session owner." };
        }

        /* On-Chain Confirmation Depth Check (Configurable) */
        const minConfirmations = Number(process.env.PREMIUM_MIN_CONFIRMATIONS || "3");
        const currentBlock = await verificationResult.provider.getBlockNumber();
        const confirmations = currentBlock - verificationResult.receipt!.blockNumber + 1;

        if (confirmations < minConfirmations) {
            console.log(`[Premium Upgrade Failed] Pending block confirmations (${confirmations}/${minConfirmations}). requestId: ${requestId}, sessionId: ${sessionId}`);
            
            await updateOwnedSession({ status: "PENDING" });

            return {
                success: false,
                status: 202,
                error: "PAYMENT_PENDING_CONFIRMATIONS"
            };
        }

        /* A verified premium payment is never retained while entitlement is denied. A transaction
           can be submitted before expiry and mined afterwards; once the canonical contract event
           proves the exact payer, recipient and terms, reconciliation grants the paid service. */
        const block = await verificationResult.provider.getBlock(verificationResult.receipt!.blockNumber);
        const blockTimestampMs = block ? block.timestamp * 1000 : 0;
        if (blockTimestampMs > expiresMs) {
            console.warn(`[Premium Upgrade Recovery] Verified payment was mined after session expiry; granting paid entitlement. requestId: ${requestId}, sessionId: ${sessionId}, txHash: ${txHash}`);
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
                const { data: existingLock, error: existingLockError } = await supabase
                    .from("webhook_events")
                    .select("event_type,payload")
                    .eq("tx_hash", txHash.toLowerCase())
                    .maybeSingle();

                if (existingLockError) {
                    throw existingLockError;
                }

                if (
                    existingLock?.event_type === "premium_upgrade" &&
                    String(existingLock?.payload?.session_id || "") === sessionId
                ) {
                    console.log(`[Premium Upgrade Recovery] Existing transaction lock belongs to this session; resuming activation. requestId: ${requestId}, sessionId: ${sessionId}, tx: ${txHash}`);
                } else {
                    console.error(`[Premium Upgrade Failed] Global transaction lock belongs to another session. requestId: ${requestId}, tx: ${txHash}`);

                    const newAttempts = (session.processing_attempts || 0) + 1;
                    const isPermanent = newAttempts >= 5;

                    await updateOwnedSession({
                        status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                        processing_attempts: newAttempts,
                        last_error: "Transaction hash has already been processed globally.",
                        failure_code: "DUPLICATE_TX"
                    });

                    return { success: false, status: 400, error: "Transaction has already been processed by another session." };
                }
            } else {
                console.error(`[Premium Upgrade Failed] Failed to record idempotency lock: ${lockError.message}`);
                throw lockError;
            }
        }

        /* 4. The subscription id is server-derived exclusively from the verified canonical event.
           Never trust a caller-supplied id: contract ids are the ownership boundary for billing. */
        let extractedSubId = verificationResult.subId ? Number(verificationResult.subId) : undefined;
        if (!extractedSubId) {
            const subscriptInterface = new ethers.Interface([
                "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)"
            ]);
            for (const log of verificationResult.receipt!.logs) {
                try {
                    const parsed = subscriptInterface.parseLog(log);
                    if (parsed?.name === "SubscriptionCreated") {
                        extractedSubId = Number(parsed.args.subId);
                        break;
                    }
                } catch {
                    /* Ignore log parsing errors */
                }
            }
        }

        if (!extractedSubId) {
            throw new Error("Unable to extract subscription ID from transaction logs.");
        }

        /* 5. Activate premium subscription */
        const provider = verificationResult.provider;
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        
        await activateSubscription({
            supabase,
            merchantAddress: normalizedUser,
            txHash,
            adminWallet,
            sessionId,
            subId: extractedSubId,
            claimId: processingClaimId,
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

        await updateOwnedSession({
            status: isPermanent ? "FAILED_PERMANENTLY" : "PENDING",
            processing_attempts: newAttempts,
            last_error: error.message || "Internal Server Error",
            failure_code: failureCode
        });

        if (isPermanent) {
            console.error(`[ALERT] FAILED_PERMANENTLY checkout session: ${sessionId}, reason: ${failureCode}, requestId: ${requestId}`);
        }

        return { success: false, status: 500, error: error.message || "Internal Server Error" };
    }
}
