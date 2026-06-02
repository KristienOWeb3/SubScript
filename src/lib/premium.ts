import { ethers } from "ethers";
import {
    ARC_TESTNET_CHAIN_ID,
    PREMIUM_PLAN_PRICE_USDC,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";

const PREMIUM_AMOUNT = ethers.parseUnits(PREMIUM_PLAN_PRICE_USDC, 6);

const ROUTER_INTERFACE = new ethers.Interface([
    "function setMerchantTier(address _merchant, uint8 _tier) external",
    "function merchantTiers(address) view returns (uint8)"
]);

const ERC20_INTERFACE = new ethers.Interface([
    "function transfer(address to, uint256 value) external",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const findTransfer = (
    receipt: ethers.TransactionReceipt,
    from: string,
    to: string,
    amount: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(USDC_NATIVE_GAS_ADDRESS)) continue;
        try {
            const parsed = ERC20_INTERFACE.parseLog(log);
            if (
                parsed?.name === "Transfer" &&
                normalizeAddress(parsed.args.from) === normalizeAddress(from) &&
                normalizeAddress(parsed.args.to) === normalizeAddress(to) &&
                BigInt(parsed.args.value) === amount
            ) {
                return true;
            }
        } catch {
            /* Ignore log parsing errors */
        }
    }
    return false;
};

export async function processPremiumUpgrade(
    supabase: any,
    walletAddress: string,
    txHash: string
): Promise<{ success: boolean; error?: string; status: number; tier?: number; upgradeTxHash?: string | null }> {
    try {
        const normalizedUser = normalizeAddress(walletAddress);
        const premiumSubId = Number(BigInt(normalizedUser) & BigInt("9007199254740991"));

        /* 1. Fetch the user's purchase intent checkout session from subscriptions table */
        const { data: subSession, error: subError } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("subscription_id", premiumSubId)
            .maybeSingle();

        if (subError) {
            console.error("[Premium Upgrade] Database fetch error for checkout session:", subError);
            return { success: false, error: "Database Error: Failed to retrieve checkout session", status: 500 };
        }

        if (!subSession) {
            return { success: false, error: "Forbidden: No premium purchase intent checkout session found. Please click pay again.", status: 400 };
        }

        /* Enforce State Machine allowed transitions: block updates out of ACTIVE state */
        if (subSession.status === "ACTIVE") {
            return {
                success: true,
                status: 200,
                tier: 1,
                upgradeTxHash: null
            };
        }

        if (subSession.status !== "PENDING" && subSession.status !== "FAILED") {
            return { success: false, error: `Forbidden: Invalid subscription status transition from '${subSession.status}'`, status: 400 };
        }

        /* Verify checkout session intent expiration */
        const nowMs = Date.now();
        const expiresMs = new Date(subSession.expires_at).getTime();
        if (nowMs > expiresMs) {
            return { success: false, error: "Forbidden: Premium checkout session has expired. Please create a new checkout session.", status: 400 };
        }

        /* 2. Replay Protection: Check if this transaction hash was already processed */
        const { data: existingSubByTx, error: txCheckError } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("payment_tx_hash", txHash)
            .maybeSingle();

        if (txCheckError) {
            console.error("[Premium Upgrade] Database fetch error checking transaction replay:", txCheckError);
        }

        if (existingSubByTx) {
            if (existingSubByTx.merchant_address.toLowerCase() !== normalizedUser) {
                return { success: false, error: "Forbidden: Transaction registered to a different user", status: 403 };
            }
            if (existingSubByTx.status === "ACTIVE") {
                return {
                    success: true,
                    status: 200,
                    tier: 1,
                    upgradeTxHash: null
                };
            }
        }

        /* 3. Database Idempotency Lock: Try inserting the transaction hash into webhook_events */
        const { error: lockError } = await supabase
            .from("webhook_events")
            .insert({
                tx_hash: txHash.toLowerCase(),
                event_type: "premium_upgrade",
                payload: {
                    wallet_address: normalizedUser,
                    amount: "10 USDC",
                    timestamp: new Date().toISOString()
                }
            });

        if (lockError) {
            if (lockError.code === "23505") { /* unique_violation */
                console.log(`[Premium Upgrade Replay Blocked] Transaction hash ${txHash} already locked in webhook_events.`);
                return {
                    success: true,
                    status: 200,
                    tier: 1,
                    upgradeTxHash: null
                };
            }
            console.error("[Premium Upgrade] Database locking error:", lockError);
            return { success: false, error: "Locking database session failed. Please retry.", status: 500 };
        }

        /* Update status to PENDING and save payment_tx_hash during verification */
        await supabase
            .from("subscriptions")
            .update({
                payment_tx_hash: txHash,
                status: "PENDING",
                updated_at: new Date().toISOString()
            })
            .eq("subscription_id", premiumSubId);

        /* 4. Connect to network and validate receipt */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return { success: false, error: "Configuration Error: Admin private key missing on server", status: 500 };
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
            return { success: false, error: `Network mismatch: expected Arc Testnet ${ARC_TESTNET_CHAIN_ID}, got ${network.chainId}`, status: 400 };
        }

        const [tx, receipt] = await Promise.all([
            provider.getTransaction(txHash),
            provider.getTransactionReceipt(txHash)
        ]);

        if (!tx || !receipt) {
            return { success: false, error: "Transaction receipt not found. Please try again in a few seconds.", status: 404 };
        }

        /* Confirmations Count gate */
        const minConfirmations = Number(process.env.MIN_PAYMENT_CONFIRMATIONS || "1");
        const confirmations = await receipt.confirmations();
        if (confirmations < minConfirmations) {
            return { success: false, error: `Verification Failed: Awaiting confirmations (received ${confirmations}/${minConfirmations})`, status: 400 };
        }

        if (receipt.status !== 1) {
            await supabase.from("subscriptions").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("subscription_id", premiumSubId);
            return { success: false, error: "Premium payment transaction failed or reverted on-chain", status: 400 };
        }

        /* Identity matching: transaction sender == receipt sender == expected merchant address == merchant address on intent */
        if (
            normalizeAddress(receipt.from) !== normalizedUser ||
            normalizeAddress(tx.from) !== normalizedUser ||
            normalizeAddress(subSession.merchant_address) !== normalizedUser
        ) {
            return { success: false, error: "Forbidden: Transaction sender does not match connected wallet identity", status: 403 };
        }

        /* Target contract matching: target contract address must be the native stablecoin gas address */
        if (
            !receipt.to ||
            !tx.to ||
            normalizeAddress(receipt.to) !== normalizeAddress(USDC_NATIVE_GAS_ADDRESS) ||
            normalizeAddress(tx.to) !== normalizeAddress(USDC_NATIVE_GAS_ADDRESS)
        ) {
            return { success: false, error: "Verification Failed: USDC stablecoin contract was not targeted", status: 400 };
        }

        /* Input parameters validation */
        let parsedTx;
        try {
            parsedTx = ERC20_INTERFACE.parseTransaction({ data: tx.data, value: tx.value });
        } catch (e) {
            return { success: false, error: "Verification Failed: Could not parse transaction calldata", status: 400 };
        }

        if (
            !parsedTx ||
            parsedTx.name !== "transfer" ||
            normalizeAddress(parsedTx.args[0]) !== normalizeAddress(SUBSCRIPT_ROUTER_ADDRESS) ||
            BigInt(parsedTx.args[1]) !== PREMIUM_AMOUNT
        ) {
            return { success: false, error: "Verification Failed: Calldata does not represent a 10 USDC transfer to SubScript Router Proxy", status: 400 };
        }

        /* Transfer logs parameter validation */
        if (!findTransfer(receipt, normalizedUser, SUBSCRIPT_ROUTER_ADDRESS, PREMIUM_AMOUNT)) {
            return { success: false, error: "Verification Failed: 10 USDC transfer to premium router proxy not found in receipt logs", status: 400 };
        }

        /* Block age check (must be within the last 24 hours) */
        const block = await provider.getBlock(receipt.blockNumber);
        if (!block) {
            return { success: false, error: "Verification Failed: Block metadata could not be retrieved", status: 500 };
        }

        const nowSec = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSec - block.timestamp) > 86400) {
            return { success: false, error: "Verification Failed: Transaction is too old (older than 24 hours)", status: 400 };
        }

        /* 5. Stateful Self-Healing Activation sequence */
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        const contract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, ROUTER_INTERFACE, adminWallet);

        const currentContractTier = await contract.merchantTiers(normalizedUser);
        let upgradeTxHash = null;

        if (Number(currentContractTier) < 1) {
            try {
                await contract.setMerchantTier.staticCall(normalizedUser, 1);
            } catch (error: any) {
                console.error("[Premium Upgrade] Tier upgrade static call failed:", error);
                return { success: false, error: error.reason || error.shortMessage || error.message || "Premium tier upgrade access-control check failed", status: 500 };
            }

            const upgradeTx = await contract.setMerchantTier(normalizedUser, 1);
            const upgradeReceipt = await upgradeTx.wait();
            if (upgradeReceipt.status !== 1) {
                await supabase.from("subscriptions").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("subscription_id", premiumSubId);
                return { success: false, error: "On-chain admin upgrade transaction failed", status: 500 };
            }
            upgradeTxHash = upgradeTx.hash;
        }

        const upgradedTier = await contract.merchantTiers(normalizedUser);
        if (Number(upgradedTier) < 1) {
            await supabase.from("subscriptions").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("subscription_id", premiumSubId);
            return { success: false, error: "On-chain tier verification failed after upgrade", status: 500 };
        }

        /* 6. Database updates */
        const { error: dbError } = await supabase
            .from("merchants")
            .upsert({
                wallet_address: normalizedUser,
                tier: 1
            }, { onConflict: "wallet_address" });

        if (dbError) {
            console.error("[Premium Upgrade] Database sync error on merchants:", dbError);
            return { success: false, error: "Premium upgraded on-chain, but merchant database sync failed", status: 500 };
        }

        const { error: subDbError } = await supabase
            .from("subscriptions")
            .update({
                status: "ACTIVE",
                updated_at: new Date().toISOString()
            })
            .eq("subscription_id", premiumSubId);

        if (subDbError) {
            console.error("[Premium Upgrade] Database sync error on subscriptions:", subDbError);
            return { success: false, error: "Premium upgraded on-chain, but subscription database sync failed", status: 500 };
        }

        return {
            success: true,
            status: 200,
            tier: 1,
            upgradeTxHash
        };
    } catch (error: any) {
        console.error("Premium upgrade error:", error);
        return { success: false, error: error.reason || error.shortMessage || error.message || "Internal Server Error", status: 500 };
    }
}
