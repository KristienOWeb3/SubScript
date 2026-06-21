import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS, STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import crypto from "crypto";
import { triggerExitSurvey } from "@/lib/payments/email";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
    "function executePayment(uint256 _subId, uint256 _sequenceId) external",
    "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
    "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)"
];

const ROUTER_ABI = [
    "function merchantTiers(address) view returns (uint8)",
    "function setMerchantTier(address _merchant, uint8 _tier) external"
];

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

async function createBillingDm({
    supabase,
    senderAddress,
    receiverAddress,
    messageType,
    amountUsdc,
    title,
    description,
    txHash,
}: {
    supabase: any;
    senderAddress: string;
    receiverAddress: string;
    messageType: "DEBIT_SUCCESS" | "EXPIRY_WARNING";
    amountUsdc: bigint | string | number;
    title: string;
    description: string;
    txHash?: string | null;
}) {
    const { data: customerSettings } = await supabase
        .from("customers")
        .select("push_enabled, debit_success_enabled, expiry_warning_enabled")
        .eq("wallet_address", receiverAddress.toLowerCase())
        .maybeSingle();

    if (customerSettings?.push_enabled === false) return;
    if (messageType === "DEBIT_SUCCESS" && customerSettings?.debit_success_enabled === false) return;
    if (messageType === "EXPIRY_WARNING" && customerSettings?.expiry_warning_enabled === false) return;

    await supabase
        .from("subscript_dms")
        .insert({
            sender_address: senderAddress.toLowerCase(),
            receiver_address: receiverAddress.toLowerCase(),
            message_type: messageType,
            status: "PENDING",
            amount_usdc: amountUsdc.toString(),
            title,
            description,
            tx_hash: txHash || null,
        });
}

export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
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

        /* A. Process Graceful Downgrades first */
        const { data: cancelSubs, error: cancelError } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("status", "ACTIVE")
            .eq("cancel_at_period_end", true)
            .lte("next_billing_date", new Date().toISOString());

        const downgradeResults = [];

        if (cancelError) {
            console.error("Error querying subscriptions for downgrade:", cancelError);
        } else {
            for (const sub of (cancelSubs || [])) {
                const subId = Number(sub.subscription_id);
                const merchantAddress = sub.merchant_address;

                try {
                    /* Verify DB merchant tier is indeed 1 (Addition 2) */
                    const { data: merchant, error: mError } = await supabase
                        .from("merchants")
                        .select("tier")
                        .eq("wallet_address", merchantAddress)
                        .maybeSingle();

                    if (mError || !merchant || merchant.tier !== "PREMIUM") {
                        console.warn(`[Downgrade Check] Merchant ${merchantAddress} tier is not PREMIUM (got ${merchant?.tier}). Skipping downgrade.`);
                        continue;
                    }

                    /* Execute on-chain downgrade (setMerchantTier to 0) */
                    const currentContractTier = Number(await routerContract.merchantTiers(merchantAddress));
                    let downgradeTxHash = null;

                    if (currentContractTier > 0) {
                        const tx = await routerContract.setMerchantTier(merchantAddress, 0);
                        const receipt = await tx.wait();
                        if (receipt.status !== 1) {
                            throw new Error("On-chain downgrade transaction reverted");
                        }
                        downgradeTxHash = tx.hash;
                    }

                    /* On-chain success confirmed: update DB to tier = 'FREE' and status = CANCELED (Addition 2) */
                    await supabase
                        .from("merchants")
                        .update({
                            tier: "FREE",
                            updated_at: new Date().toISOString()
                        })
                        .eq("wallet_address", merchantAddress);

                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "CANCELED",
                            tier: 0,
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    const adminPrivateKey = process.env.PRIVATE_KEY || "";
                    const adminAddress = adminPrivateKey 
                        ? new ethers.Wallet(adminPrivateKey).address.toLowerCase()
                        : "";
                    if (adminAddress) {
                        triggerExitSurvey(adminAddress, merchantAddress, 1).catch(err => {
                            console.error("Failed to trigger exit survey:", err);
                        });
                    }

                    downgradeResults.push({
                        subId,
                        merchantAddress,
                        action: "DOWNGRADED",
                        success: true,
                        txHash: downgradeTxHash
                    });

                } catch (err: any) {
                    console.error(`[Downgrade Failed] Failed to downgrade subscription ${subId} for ${merchantAddress}:`, err);

                    /* On-chain failure: leave ACTIVE, keep cancel_at_period_end = true, increment downgrade_failures (Addition 3) */
                    const currentFailures = Number(sub.downgrade_failures || 0);
                    await supabase
                        .from("subscriptions")
                        .update({
                            downgrade_failures: currentFailures + 1,
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    downgradeResults.push({
                        subId,
                        merchantAddress,
                        action: "DOWNGRADE_FAILED",
                        success: false,
                        error: err.message || "Unknown error"
                    });
                }
            }
        }

        /* 4. Query active/failed/past_due subscriptions from DB */
        const { data: dbSubs, error: dbError } = await supabase
            .from("subscriptions")
            .select("*")
            .in("status", ["ACTIVE", "FAILED", "PAST_DUE"]);

        if (dbError) {
            return NextResponse.json({ error: `Database error: ${dbError.message}` }, { status: 500 });
        }

        const now = new Date();
        const results = [];

        for (const sub of (dbSubs || [])) {
            if (sub.cancel_at_period_end) {
                continue;
            }
            const subId = Number(sub.subscription_id);
            const nextBilling = new Date(sub.next_billing_date);
            const lastSettlement = new Date(sub.last_settlement_timestamp);
            const retryExpiry = new Date(lastSettlement.getTime() + 60 * 24 * 60 * 60 * 1000); /* 60 days total: 30 days interval + 30 days retries */

            let isEligible = false;
            if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") {
                isEligible = nextBilling <= now;
            } else if (sub.status === "FAILED") {
                isEligible = sub.tier === 0 && now <= retryExpiry;
            }

            if (!isEligible) {
                continue;
            }

            const handlePaymentFailure = async (subscriberAddress: string, failureReason: string) => {
                const currentFailures = Number(sub.downgrade_failures || 0);
                const previousStatus = sub.status;
                await createBillingDm({
                    supabase,
                    senderAddress: sub.merchant_address,
                    receiverAddress: subscriberAddress,
                    messageType: "EXPIRY_WARNING",
                    amountUsdc: sub.amount_cap_usdc || 0,
                    title: "Subscription renewal needs attention",
                    description: [
                        "SubScript could not complete this subscription renewal.",
                        `Reason: ${failureReason}`,
                        "Choose resubscribe after adding USDC, or cancel the premium plan from your dashboard.",
                    ].join("\n"),
                }).catch((dmErr: any) => console.error("Failed to create renewal warning DM:", dmErr));

                if (previousStatus === "ACTIVE") {
                    console.log(`[Premium Entered Past Due] requestId: ${requestId}, merchantAddress: ${subscriberAddress}, subscriptionId: ${subId}`);
                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "PAST_DUE",
                            downgrade_failures: 1,
                            updated_at: new Date().toISOString()
                        })
                        .eq("subscription_id", subId);

                    results.push({
                        subId,
                        subscriber: subscriberAddress,
                        action: "ENTERED_PAST_DUE",
                        success: false,
                        error: failureReason
                    });
                } else if (previousStatus === "PAST_DUE") {
                    const newFailures = currentFailures + 1;
                    if (newFailures < 3) {
                        console.log(`[Premium Past Due Retry] requestId: ${requestId}, merchantAddress: ${subscriberAddress}, subscriptionId: ${subId}, failures: ${newFailures}`);
                        await supabase
                            .from("subscriptions")
                            .update({
                                downgrade_failures: newFailures,
                                updated_at: new Date().toISOString()
                            })
                            .eq("subscription_id", subId);

                        results.push({
                            subId,
                            subscriber: subscriberAddress,
                            action: "PAST_DUE_RETRY",
                            success: false,
                            failuresCount: newFailures,
                            error: failureReason
                        });
                    } else {
                        /* 3rd failure: perform downgrade */
                        console.log(`[Premium Downgrade Triggered] requestId: ${requestId}, merchantAddress: ${subscriberAddress}, subscriptionId: ${subId}`);
                        const currentContractTier = Number(await routerContract.merchantTiers(subscriberAddress));
                        let downgradeTxHash = null;

                        if (currentContractTier > 0) {
                            const tx = await routerContract.setMerchantTier(subscriberAddress, 0);
                            const receipt = await tx.wait();
                            if (receipt.status !== 1) {
                                throw new Error("Downgrade transaction reverted");
                            }
                            downgradeTxHash = tx.hash;
                        }
                        console.log(`[Premium Downgrade Confirmed] requestId: ${requestId}, merchantAddress: ${subscriberAddress}, subscriptionId: ${subId}, txHash: ${downgradeTxHash}`);

                        await supabase
                            .from("subscriptions")
                            .update({
                                status: "FAILED",
                                tier: 0,
                                downgrade_failures: newFailures,
                                updated_at: new Date().toISOString()
                            })
                            .eq("subscription_id", subId);

                        await supabase
                            .from("merchants")
                            .update({
                                tier: "FREE",
                                updated_at: new Date().toISOString()
                            })
                            .eq("wallet_address", subscriberAddress.toLowerCase());

                        if (sub.tier === 1) {
                            const adminPrivateKey = process.env.PRIVATE_KEY || "";
                            const adminAddress = adminPrivateKey 
                                ? new ethers.Wallet(adminPrivateKey).address.toLowerCase()
                                : "";
                            if (adminAddress) {
                                triggerExitSurvey(adminAddress, subscriberAddress, 1).catch(err => {
                                    console.error("Failed to trigger exit survey:", err);
                                });
                            }
                        } else if (sub.tier === 0) {
                            triggerExitSurvey(sub.merchant_address, subscriberAddress, 0).catch(err => {
                                console.error("Failed to trigger exit survey:", err);
                            });
                        }

                        results.push({
                            subId,
                            subscriber: subscriberAddress,
                            action: "DOWNGRADED_MAX_FAILURES",
                            success: false,
                            failuresCount: newFailures,
                            downgradeTxHash,
                            error: failureReason
                        });
                    }
                } else {
                    results.push({
                        subId,
                        subscriber: subscriberAddress,
                        action: "RENEWAL_FAILED",
                        success: false,
                        error: failureReason
                    });
                }
            };

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
                            tier: "FREE",
                            updated_at: new Date().toISOString()
                        })
                        .eq("wallet_address", subscriber.toLowerCase());

                    if (sub.tier === 1) {
                        const adminPrivateKey = process.env.PRIVATE_KEY || "";
                        const adminAddress = adminPrivateKey 
                            ? new ethers.Wallet(adminPrivateKey).address.toLowerCase()
                            : "";
                        if (adminAddress) {
                            triggerExitSurvey(adminAddress, subscriber, 1).catch(err => {
                                console.error("Failed to trigger exit survey:", err);
                            });
                        }
                    } else if (sub.tier === 0) {
                        triggerExitSurvey(sub.merchant_address, subscriber, 0).catch(err => {
                            console.error("Failed to trigger exit survey:", err);
                        });
                    }

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
                    await handlePaymentFailure(subscriber, "Insufficient balance or allowance");
                    continue;
                }

                /* Determine the next sequence ID */
                let sequenceId = 1;
                while (await standardContract.isSequenceExecuted(subId, sequenceId)) {
                    sequenceId++;
                }

                /* Check if payment is due on-chain */
                const isDueOnChain = await standardContract.isPaymentDue(subId, sequenceId);
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
                const tx = await standardContract.executePayment(subId, sequenceId);
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

                if (sub.status === "PAST_DUE") {
                    console.log(`[Premium Past Due Recovery] requestId: ${requestId}, merchantAddress: ${subscriber}, subscriptionId: ${subId}, txHash: ${tx.hash}`);
                }

                await createBillingDm({
                    supabase,
                    senderAddress: sub.merchant_address,
                    receiverAddress: subscriber,
                    messageType: "DEBIT_SUCCESS",
                    amountUsdc: requiredAmount,
                    title: "Subscription renewed",
                    description: [
                        "SubScript successfully renewed your subscription.",
                        `Amount debited: ${Number(requiredAmount) / 1_000_000} USDC`,
                        `Subscription ID: ${subId}`,
                    ].join("\n"),
                    txHash: tx.hash,
                }).catch((dmErr: any) => console.error("Failed to create renewal receipt DM:", dmErr));

                /* Update database to ACTIVE and tier 1 */
                await supabase
                    .from("subscriptions")
                    .update({
                        status: "ACTIVE",
                        tier: 1,
                        downgrade_failures: 0,
                        last_settlement_timestamp: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq("subscription_id", subId);

                await supabase
                    .from("merchants")
                    .update({
                        tier: "PREMIUM",
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
                try {
                    const subOnChain = await standardContract.subscriptions(subId);
                    const subscriber = subOnChain[0];
                    await handlePaymentFailure(subscriber, err.message || "Unknown error");
                } catch (fallbackErr: any) {
                    console.error(`Fallback check failed for sub ${subId}:`, fallbackErr);
                    results.push({
                        subId,
                        action: "EXECUTION_FAILED",
                        success: false,
                        error: err.message || "Unknown error"
                    });
                }
            }
        }

        return NextResponse.json({ success: true, processed: results.length, results, downgrades: downgradeResults }, { status: 200 });

    } catch (error: any) {
        console.error("Cron billing worker error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
