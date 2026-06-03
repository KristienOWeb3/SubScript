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
    sessionId
}: {
    supabase: any;
    merchantAddress: string;
    txHash: string;
    adminWallet: ethers.Wallet;
    sessionId: string;
}) {
    const normalizedUser = normalizeAddress(merchantAddress);
    const premiumSubId = Number(BigInt(normalizedUser) & BigInt("9007199254740991"));

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
        console.log(`[activation_skipped] Merchant ${normalizedUser} is already premium on-chain and database.`);
        
        /* Ensure the payment session is marked COMPLETED */
        await supabase
            .from("payment_sessions")
            .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
            .eq("session_id", sessionId);

        return;
    }

    /* 3. Execute on-chain tier activation if required */
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
        console.log(`[tier_updated] Tier activated on-chain. Tx: ${activationTxHash}`);
    } else {
        console.log(`[activation_skipped] Merchant already premium on-chain.`);
    }

    /* 4. Atomic entitlement sync in database */
    const { error: merchantUpsertError } = await supabase
        .from("merchants")
        .upsert({
            wallet_address: normalizedUser,
            tier: 1,
            updated_at: new Date().toISOString()
        }, { onConflict: "wallet_address" });

    if (merchantUpsertError) {
        console.error(`[db_updated] Failed to upsert merchant: ${merchantUpsertError.message}`);
        throw merchantUpsertError;
    }

    const { error: subUpsertError } = await supabase
        .from("subscriptions")
        .upsert({
            subscription_id: premiumSubId,
            merchant_address: normalizedUser,
            current_nonce: 0,
            last_settlement_timestamp: new Date().toISOString(),
            billing_interval_seconds: 2592000,
            amount_cap_usdc: 10,
            payment_tx_hash: txHash,
            status: "ACTIVE",
            tier: 1,
            updated_at: new Date().toISOString()
        }, { onConflict: "subscription_id" });

    if (subUpsertError) {
        console.error(`[db_updated] Failed to upsert subscription: ${subUpsertError.message}`);
        throw subUpsertError;
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
            activation_tx_hash: activationTxHash
        });

    if (auditError) {
        /* Log error but do not revert entire transaction if audit record fails */
        console.error(`[db_updated] Failed to write premium upgrade audit record: ${auditError.message}`);
    } else {
        /* Observability metric log */
        console.log(`[metric] premium_upgrades_successful: ${sessionId}, merchant: ${normalizedUser}`);
    }

    const { error: sessionUpdateError } = await supabase
        .from("payment_sessions")
        .update({
            status: "COMPLETED",
            updated_at: new Date().toISOString()
        })
        .eq("session_id", sessionId);

    if (sessionUpdateError) {
        console.error(`[db_updated] Failed to finalize payment session status: ${sessionUpdateError.message}`);
        throw sessionUpdateError;
    }

    console.log(`[db_updated] Merchant premium tier synchronization complete for ${normalizedUser}`);
}
