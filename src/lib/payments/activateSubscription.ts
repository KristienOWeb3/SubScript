import { ethers } from "ethers";
import { ROUTER_ADDRESS, ARC_TESTNET_CHAIN_ID } from "./constants";

const ROUTER_INTERFACE = new ethers.Interface([
    "function setMerchantTier(address _merchant, uint8 _tier) external",
    "function merchantTiers(address) view returns (uint8)"
]);

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

export async function activateSubscription({
    supabase,
    merchantAddress,
    txHash,
    adminWallet,
    sessionId,
    subId,
    rpcEndpoint,
    requestId = "unknown"
}: {
    supabase: any;
    merchantAddress: string;
    txHash: string;
    adminWallet: ethers.Wallet;
    sessionId: string;
    subId: number;
    rpcEndpoint?: string;
    requestId?: string;
}) {
    const normalizedUser = normalizeAddress(merchantAddress);

    /* 1. Fetch merchant details from database to avoid redundant writes and capture prior tier */
    const { data: merchant, error: fetchError } = await supabase
        .from("merchants")
        .select("*")
        .eq("wallet_address", normalizedUser)
        .maybeSingle();

    if (fetchError) {
        console.error(`[db_updated] Failed to fetch merchant during activation: ${fetchError.message}`);
        throw fetchError;
    }

    const tierBefore = merchant ? merchant.tier : 0;
    const contract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_INTERFACE, adminWallet);

    /* 2. On-chain tier check */
    let currentContractTier = 0;
    try {
        currentContractTier = Number(await contract.merchantTiers(normalizedUser));
    } catch (err) {
        console.error(`[db_updated] Failed to verify merchant tier on-chain:`, err);
    }

    let activationTxHash = txHash;

    if (merchant && merchant.tier >= 1 && currentContractTier >= 1) {
        console.log(`[activation_skipped] Merchant ${normalizedUser} is already premium on-chain and database. requestId: ${requestId}`);
        
        /* Ensure the payment session is marked COMPLETED */
        const { error: sessionUpdateError } = await supabase
            .from("payment_sessions")
            .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
            .eq("session_id", sessionId);

        if (sessionUpdateError) {
            console.error(`[db_updated] Failed to finalize payment session status: ${sessionUpdateError.message}`);
            throw sessionUpdateError;
        }

        return;
    }

    /* Circuit Breaker Check: Verify upgrades are active */
    if (process.env.ADMIN_UPGRADE_DISABLED === "true") {
        console.warn(`[ALERT] [Premium Upgrade Failed] ADMIN_UPGRADE_DISABLED circuit breaker is active. requestId: ${requestId}, sessionId: ${sessionId}`);
        const { error: sessionUpdateError } = await supabase
            .from("payment_sessions")
            .update({
                status: "PENDING",
                last_error: "Premium upgrades are temporarily paused by administrator.",
                updated_at: new Date().toISOString()
            })
            .eq("session_id", sessionId);

        if (sessionUpdateError) {
            console.error(`[db_updated] Failed to update payment session status under circuit breaker: ${sessionUpdateError.message}`);
        }
        throw new Error("Admin upgrade disabled");
    }

    /* 3. Execute on-chain tier activation if required */
    let onChainUpdated = false;
    if (currentContractTier < 1) {
        try {
            await contract.setMerchantTier.staticCall(normalizedUser, 1);
        } catch (error: any) {
            console.error(`[db_updated] staticCall setMerchantTier failed:`, error);
            throw new Error(`On-chain static call validation failed: ${error.reason || error.message}`);
        }

        const upgradeTx = await contract.setMerchantTier(normalizedUser, 1);
        const upgradeReceipt = await upgradeTx.wait();
        if (upgradeReceipt.status !== 1) {
            console.error(`[db_updated] setMerchantTier transaction reverted`);
            throw new Error("On-chain setMerchantTier transaction failed");
        }
        activationTxHash = upgradeTx.hash;
        onChainUpdated = true;
        console.log(`[tier_updated] Tier activated on-chain. Tx: ${activationTxHash}, requestId: ${requestId}`);
    } else {
        console.log(`[activation_skipped] Merchant already premium on-chain. requestId: ${requestId}`);
    }

    /* 4. Atomic entitlement sync in database using PL/pgSQL function */
    try {
        const premiumSubId = subId;
        const { error: rpcError } = await supabase.rpc("activate_premium_merchant", {
            p_merchant_address: normalizedUser,
            p_subscription_id: premiumSubId,
            p_session_id: sessionId,
            p_tx_hash: txHash,
            p_amount: 10,
            p_period: 2592000
        });

        if (rpcError) {
            console.error(`[db_updated] Failed to call activate_premium_merchant RPC: ${rpcError.message}`);
            throw rpcError;
        }

        /* 5. Insert Premium Activation Audit Record */
        const { error: auditError } = await supabase
            .from("premium_upgrade_events")
            .insert({
                merchant: normalizedUser,
                payment_session: sessionId,
                tx_hash: txHash,
                chain_id: ARC_TESTNET_CHAIN_ID,
                tier_before: tierBefore,
                tier_after: 1,
                admin_wallet: adminWallet.address.toLowerCase(),
                activation_tx_hash: activationTxHash,
                rpc_endpoint: rpcEndpoint || null
            });

        if (auditError) {
            /* Log error but do not revert entire transaction if audit record fails */
            console.error(`[db_updated] Failed to write premium upgrade audit record: ${auditError.message}`);
        } else {
            /* Observability metric log */
            console.log(`[metric] premium_upgrades_successful: ${sessionId}, merchant: ${normalizedUser}`);
        }

        console.log(`[db_updated] Merchant premium tier synchronization complete for ${normalizedUser}, requestId: ${requestId}`);

    } catch (dbError: any) {
        console.error(`[db_updated] Database activation failed. requestId: ${requestId}, error: ${dbError.message || dbError}`);
        
        if (onChainUpdated || currentContractTier >= 1) {
            console.warn(`[ALERT] [Needs Reconciliation] On-chain succeeded but DB failed. sessionId: ${sessionId}, merchant: ${normalizedUser}`);
            await supabase
                .from("payment_sessions")
                .update({
                    status: "NEEDS_RECONCILIATION",
                    last_error: `On-chain upgrade succeeded but database write failed: ${dbError.message || dbError}`,
                    updated_at: new Date().toISOString()
                })
                .eq("session_id", sessionId);
        }
        throw dbError;
    }
}
