import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS, STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
    "function executePayment(uint256 _subId) external",
    "function isPaymentDue(uint256 _subId) view returns (bool)"
];

const ROUTER_ABI = [
    "function merchantTiers(address) view returns (uint8)",
    "function setMerchantTier(address _merchant, uint8 _tier) external"
];

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

export async function POST(request: Request) {
    try {
        /* 1. Authenticate with keeper secret key */
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Internal Server Error: Keeper secret key configuration missing" }, { status: 500 });
        }

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /* 2. Connect to Supabase */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* 3. Connect to Web3 provider and wallet */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

        const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, STANDARD_ABI, adminWallet);
        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, ROUTER_ABI, adminWallet);
        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ERC20_ABI, adminWallet);

        /* 4. Query active/failed subscriptions from DB */
        const { data: dbSubs, error: dbError } = await supabase
            .from("subscriptions")
            .select("*")
            .in("status", ["ACTIVE", "FAILED"]);

        if (dbError) {
            return NextResponse.json({ error: `Database error: ${dbError.message}` }, { status: 500 });
        }

        const now = new Date();
        const results = [];

        for (const sub of (dbSubs || [])) {
            const subId = Number(sub.subscription_id);
            const nextBilling = new Date(sub.next_billing_date);
            const lastSettlement = new Date(sub.last_settlement_timestamp);
            const retryExpiry = new Date(lastSettlement.getTime() + 60 * 24 * 60 * 60 * 1000); /* 60 days total: 30 days interval + 30 days retries */

            let isEligible = false;
            if (sub.status === "ACTIVE") {
                isEligible = nextBilling <= now;
            } else if (sub.status === "FAILED") {
                isEligible = sub.tier === 0 && now <= retryExpiry;
            }

            if (!isEligible) {
                continue;
            }

            try {
                /* Fetch subscription state on-chain */
                const subOnChain = await standardContract.subscriptions(subId);
                const subscriber = subOnChain[0]; /* subscriber address */
                const isActiveOnChain = subOnChain[5]; /* isActive boolean */

                /* Handle on-chain cancellation */
                if (!isActiveOnChain) {
                    /* On-chain is cancelled, so we downgrade and stop retries */
                    const currentContractTier = Number(await routerContract.merchantTiers(subscriber));
                    let downgradeTxHash = null;

                    if (currentContractTier > 0) {
                        const tx = await routerContract.setMerchantTier(subscriber, 0);
                        const receipt = await tx.wait();
                        if (receipt.status !== 1) {
                            throw new Error("Downgrade transaction reverted");
                        }
                        downgradeTxHash = tx.hash;
                    }

                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "FAILED",
                            tier: 0,
                            last_settlement_timestamp: new Date(0).toISOString(), /* Sentinel value to stop further retries */
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    await supabase
                        .from("merchants")
                        .update({
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("wallet_address", subscriber.toLowerCase());

                    results.push({
                        subId,
                        subscriber,
                        action: "CANCELLED_ON_CHAIN",
                        success: true,
                        downgradeTxHash
                    });
                    continue;
                }

                /* Active on-chain, check balance and allowance */
                const balance = await usdcContract.balanceOf(subscriber);
                const allowance = await usdcContract.allowance(subscriber, STANDARD_CONTRACT_ADDRESS);
                const requiredAmount = BigInt(subOnChain[2] || "10000000"); /* amount is index 2 */

                if (balance < requiredAmount || allowance < requiredAmount) {
                    /* Balance or allowance is insufficient, downgrade immediately if not already downgraded */
                    const currentContractTier = Number(await routerContract.merchantTiers(subscriber));
                    let downgradeTxHash = null;

                    if (currentContractTier > 0) {
                        const tx = await routerContract.setMerchantTier(subscriber, 0);
                        const receipt = await tx.wait();
                        if (receipt.status !== 1) {
                            throw new Error("Downgrade transaction reverted");
                        }
                        downgradeTxHash = tx.hash;
                    }

                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "FAILED",
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    await supabase
                        .from("merchants")
                        .update({
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("wallet_address", subscriber.toLowerCase());

                    results.push({
                        subId,
                        subscriber,
                        action: "INSUFFICIENT_FUNDS_OR_ALLOWANCE",
                        success: false,
                        downgradeTxHash,
                        balance: balance.toString(),
                        allowance: allowance.toString()
                    });
                    continue;
                }

                /* Check if payment is due on-chain */
                const isDueOnChain = await standardContract.isPaymentDue(subId);
                if (!isDueOnChain) {
                    results.push({
                        subId,
                        subscriber,
                        action: "NOT_DUE_ON_CHAIN",
                        success: false
                    });
                    continue;
                }

                /* Execute payment */
                const tx = await standardContract.executePayment(subId);
                const receipt = await tx.wait();
                if (receipt.status !== 1) {
                    throw new Error("Payment execution transaction reverted");
                }

                /* Upgrade/Restore merchant tier on-chain */
                const currentContractTier = Number(await routerContract.merchantTiers(subscriber));
                let upgradeTxHash = null;

                if (currentContractTier < 1) {
                    const txUpgrade = await routerContract.setMerchantTier(subscriber, 1);
                    const receiptUpgrade = await txUpgrade.wait();
                    if (receiptUpgrade.status !== 1) {
                        throw new Error("Upgrade transaction reverted");
                    }
                    upgradeTxHash = txUpgrade.hash;
                }

                /* Update database to ACTIVE and tier 1 */
                await supabase
                    .from("subscriptions")
                    .update({
                        status: "ACTIVE",
                        tier: 1,
                        last_settlement_timestamp: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq("subscription_id", subId);

                await supabase
                    .from("merchants")
                    .update({
                        tier: 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq("wallet_address", subscriber.toLowerCase());

                results.push({
                    subId,
                    subscriber,
                    action: "PAYMENT_EXECUTED",
                    success: true,
                    txHash: tx.hash,
                    upgradeTxHash
                });

            } catch (err: any) {
                console.error(`Error processing billing for subscription ${subId}:`, err);

                /* Standard downgrade action on failure */
                let downgradeTxHash = null;
                try {
                    const subOnChain = await standardContract.subscriptions(subId);
                    const subscriber = subOnChain[0];
                    const currentContractTier = Number(await routerContract.merchantTiers(subscriber));

                    if (currentContractTier > 0) {
                        const tx = await routerContract.setMerchantTier(subscriber, 0);
                        const receipt = await tx.wait();
                        if (receipt.status === 1) {
                            downgradeTxHash = tx.hash;
                        }
                    }

                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "FAILED",
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    await supabase
                        .from("merchants")
                        .update({
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("wallet_address", subscriber.toLowerCase());

                } catch (fallbackErr: any) {
                    console.error(`Fallback downgrade failed for sub ${subId}:`, fallbackErr);
                }

                results.push({
                    subId,
                    action: "EXECUTION_FAILED",
                    success: false,
                    error: err.message || "Unknown error",
                    downgradeTxHash
                });
            }
        }

        return NextResponse.json({ success: true, processed: results.length, results }, { status: 200 });

    } catch (error: any) {
        console.error("Cron billing worker error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
