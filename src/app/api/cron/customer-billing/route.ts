/* Customer-subscription renewal keeper.
 *
 * Premium subs (merchant -> SubScript) are billed by `cron/billing`. This route bills the OTHER
 * kind: CUSTOMER subs (customer -> merchant gym-style plans) created via the embedded-wallet
 * routes and mirrored into `subscriptions` (kind = "CUSTOMER"). It is the server-side keeper for
 * when on-chain Chainlink Automation is not registered.
 *
 * Safety model (this moves real USDC, so it is deliberately conservative):
 *   - Auth: KEEPER_SECRET bearer, same as the other keeper crons. Trigger it externally on a
 *     schedule (e.g. hourly/daily) exactly like `cron/billing`.
 *   - Double-charge is impossible: the on-chain contract gates every charge by sequence
 *     (`isSequenceExecuted` / `isPaymentDue`). We only `executePayment` when BOTH our mirror says
 *     due (`next_billing_date <= now`) AND the chain says `isPaymentDue`, and we never reuse a
 *     sequence. Balance + allowance are checked first so we don't waste gas on a guaranteed revert.
 *   - `next_billing_date` is DB-derived by a trigger from `last_settlement_timestamp +
 *     billing_interval_seconds`, so on success we only stamp `last_settlement_timestamp = now`.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import crypto from "crypto";
import { STANDARD_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { dispatchMerchantWebhook } from "@/lib/webhookDispatch";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { cancelFromEmbedded } from "@/lib/subscriptions/onchain";
import { ensureGasSponsored } from "@/lib/sponsor/gas";
import { insertSupabaseDmAndNotify } from "@/lib/dms/notifications";

export const maxDuration = 300;

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
    "function executePayment(uint256 _subId, uint256 _sequenceId) external",
    "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
    "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)",
];

/* Consecutive failed renewal attempts before we park the sub as PAST_DUE and stop retrying.
   Until then it stays ACTIVE and is retried each run (cheap — only view calls until funded).
   Merchants can tune this per-account (merchants.dunning_max_failures, 1–10) — configurable
   dunning; this constant is only the fallback when no merchant row/config exists. */
const DEFAULT_MAX_RENEWAL_FAILURES = 4;

async function loadDunningConfig(supabase: any, merchantAddresses: string[]): Promise<Map<string, number>> {
    const config = new Map<string, number>();
    if (merchantAddresses.length === 0) return config;
    const { data, error } = await supabase
        .from("merchants")
        .select("wallet_address, dunning_max_failures")
        .in("wallet_address", merchantAddresses);
    if (error) {
        console.error("[customer-billing] dunning config query failed (using defaults):", error.message);
        return config;
    }
    for (const row of data || []) {
        const value = Number(row.dunning_max_failures);
        if (Number.isFinite(value) && value >= 1 && value <= 10) {
            config.set(String(row.wallet_address).toLowerCase(), value);
        }
    }
    return config;
}

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

    await insertSupabaseDmAndNotify(supabase, {
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
        /* 1. Auth — accept the keeper secret (external scheduler) or Vercel's CRON_SECRET. The
           vercel.json cron invokes this path with `Authorization: Bearer ${CRON_SECRET}`; either
           secret may be configured. */
        const authHeader = request.headers.get("Authorization");
        const keeperSecret = process.env.KEEPER_SECRET;
        const cronSecret = process.env.CRON_SECRET;
        if (!keeperSecret && !cronSecret) {
            return NextResponse.json({ error: "Internal Server Error: KEEPER_SECRET or CRON_SECRET must be configured" }, { status: 500 });
        }
        const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const authorized = !!presented && ((!!keeperSecret && presented === keeperSecret) || (!!cronSecret && presented === cronSecret));
        if (!authorized) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /* 2. Supabase */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* 3. Web3 */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, STANDARD_ABI, adminWallet);
        const usdcContract = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ERC20_ABI, adminWallet);

        /* 4. Due CUSTOMER subs: active, not flagged to cancel, and past their derived next billing. */
        const { data: dueSubs, error: dueError } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("kind", "CUSTOMER")
            .eq("status", "ACTIVE")
            .eq("cancel_at_period_end", false)
            .lte("next_billing_date", new Date().toISOString());

        if (dueError) {
            return NextResponse.json({ error: `Database error: ${dueError.message}` }, { status: 500 });
        }

        const results: any[] = [];
        const dunningConfig = await loadDunningConfig(
            supabase,
            [...new Set((dueSubs || []).map((s: any) => String(s.merchant_address).toLowerCase()))],
        );

        for (const sub of dueSubs || []) {
            const subId = Number(sub.subscription_id);
            const merchantAddress: string = sub.merchant_address;
            const maxRenewalFailures = dunningConfig.get(String(merchantAddress).toLowerCase()) ?? DEFAULT_MAX_RENEWAL_FAILURES;

            try {
                /* Authoritative on-chain state. */
                const onChain = await standardContract.subscriptions(subId);
                const subscriber: string = onChain[0];
                const amountOnChain: bigint = BigInt(onChain[2]);
                const isActiveOnChain: boolean = onChain[5];

                /* Cancelled directly on-chain -> reflect it in the mirror and notify, then stop. */
                if (!isActiveOnChain) {
                    await supabase
                        .from("subscriptions")
                        .update({ status: "CANCELED", updated_at: new Date().toISOString() })
                        .eq("subscription_id", subId);
                    await dispatchMerchantWebhook(merchantAddress, "subscription.canceled", subscriptionWebhookData({
                        subscriptionId: subId,
                        status: "canceled",
                        amountUsdcMicros: amountOnChain,
                        subscriber,
                        merchantAddress,
                        reason: "Canceled on-chain",
                    })).catch(() => { /* best-effort */ });
                    results.push({ subId, subscriber, action: "CANCELLED_ON_CHAIN", success: true });
                    continue;
                }

                /* Bill only the LATEST due sequence — never back-charge lapsed periods. Walking up
                   from the lowest unexecuted sequence would re-charge every period missed during an
                   outage or funding gap. due(seq) = nextPayment + (seq - 1) * period, so the newest
                   due sequence is floor((now - nextPayment) / period) + 1; earlier gaps stay
                   unexecuted. */
                const periodOnChain: bigint = BigInt(onChain[3]);
                const nextPaymentOnChain: bigint = BigInt(onChain[4]);
                const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
                if (nowSeconds < nextPaymentOnChain || periodOnChain <= BigInt(0)) {
                    results.push({ subId, subscriber, action: "NOT_DUE_ON_CHAIN", success: false });
                    continue;
                }
                const sequenceId = Number((nowSeconds - nextPaymentOnChain) / periodOnChain) + 1;

                if (await standardContract.isSequenceExecuted(subId, sequenceId)) {
                    results.push({ subId, subscriber, action: "ALREADY_SETTLED_ON_CHAIN", success: true });
                    continue;
                }

                /* The chain is the source of truth for "not too early". */
                const isDueOnChain = await standardContract.isPaymentDue(subId, sequenceId);
                if (!isDueOnChain) {
                    results.push({ subId, subscriber, action: "NOT_DUE_ON_CHAIN", success: false });
                    continue;
                }

                /* Fail fast (no gas) if the subscriber can't pay. */
                const balance: bigint = BigInt(await usdcContract.balanceOf(subscriber));
                const allowance: bigint = BigInt(await usdcContract.allowance(subscriber, STANDARD_CONTRACT_ADDRESS));
                if (balance < amountOnChain || allowance < amountOnChain) {
                    const failures = Number(sub.downgrade_failures || 0);
                    const newFailures = failures + 1;

                    /* Notify once, on the first failure, to avoid a message every cron run. */
                    if (failures === 0) {
                        await createBillingDm({
                            supabase,
                            senderAddress: merchantAddress,
                            receiverAddress: subscriber,
                            messageType: "EXPIRY_WARNING",
                            amountUsdc: amountOnChain,
                            title: "Subscription renewal needs attention",
                            description: [
                                "SubScript could not renew your subscription.",
                                "Reason: insufficient USDC balance or allowance.",
                                "Add USDC to keep your plan active — we'll retry automatically.",
                            ].join("\n"),
                        }).catch((e: any) => console.error("[customer-billing] warning DM failed:", e));
                        await dispatchMerchantWebhook(merchantAddress, "subscription.payment_failed", subscriptionWebhookData({
                            subscriptionId: subId,
                            status: "past_due",
                            amountUsdcMicros: amountOnChain,
                            subscriber,
                            merchantAddress,
                            reason: "Insufficient balance or allowance",
                        })).catch(() => { /* best-effort */ });
                    }

                    if (newFailures >= maxRenewalFailures) {
                        /* Zombie kill: repeated failed renewals mean the subscriber has effectively
                           abandoned the plan. Rather than leaving a live authorization that could
                           surprise-charge them later (the exact "zombie billing" SubScript exists to
                           prevent), revoke it on-chain for server-held wallets, mark it stopped so
                           the keeper stops attempting, and tell the user. External wallets can't be
                           revoked for the user, but marking it stopped still ends all charge attempts. */
                        let revokedOnChain = false;
                        try {
                            await ensureGasSponsored(subscriber.toLowerCase()).catch(() => { /* best-effort */ });
                            await cancelFromEmbedded(subscriber, BigInt(subId));
                            revokedOnChain = true;
                        } catch (killErr: any) {
                            console.warn(`[customer-billing] zombie on-chain revoke skipped for sub ${subId}:`, killErr?.message || killErr);
                        }

                        await supabase
                            .from("subscriptions")
                            .update({
                                status: revokedOnChain ? "CANCELED" : "PAST_DUE",
                                downgrade_failures: newFailures,
                                updated_at: new Date().toISOString(),
                            })
                            .eq("subscription_id", subId);

                        await createBillingDm({
                            supabase,
                            senderAddress: merchantAddress,
                            receiverAddress: subscriber,
                            messageType: "EXPIRY_WARNING",
                            amountUsdc: amountOnChain,
                            title: "Subscription stopped",
                            description: [
                                "We stopped this subscription after repeated failed renewals so it can never keep trying to charge you.",
                                revokedOnChain
                                    ? "Its on-chain authorization has been revoked."
                                    : "Cancel it from your wallet to fully revoke the authorization.",
                                "Re-subscribe anytime you're ready.",
                            ].join("\n"),
                        }).catch((e: any) => console.error("[customer-billing] zombie-kill DM failed:", e));

                        if (revokedOnChain) {
                            await dispatchMerchantWebhook(merchantAddress, "subscription.canceled", subscriptionWebhookData({
                                subscriptionId: subId,
                                status: "canceled",
                                amountUsdcMicros: amountOnChain,
                                subscriber,
                                merchantAddress,
                                reason: "Stopped after repeated failed renewals (zombie kill)",
                            })).catch(() => { /* best-effort */ });
                        }
                        results.push({ subId, subscriber, action: "ZOMBIE_KILLED", success: false, failuresCount: newFailures, revokedOnChain });
                    } else {
                        /* Keep ACTIVE and retry next run (cheap — only view calls until funded). */
                        await supabase
                            .from("subscriptions")
                            .update({ downgrade_failures: newFailures, updated_at: new Date().toISOString() })
                            .eq("subscription_id", subId);
                        results.push({ subId, subscriber, action: "RETRY_SCHEDULED", success: false, failuresCount: newFailures });
                    }
                    continue;
                }

                /* Charge. */
                const tx = await standardContract.executePayment(subId, sequenceId);
                const receipt = await tx.wait();
                if (receipt.status !== 1) {
                    throw new Error("Payment execution transaction reverted");
                }

                /* Stamp settlement; the trigger derives the next billing date. Reset failures. */
                await supabase
                    .from("subscriptions")
                    .update({
                        status: "ACTIVE",
                        downgrade_failures: 0,
                        last_settlement_timestamp: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq("subscription_id", subId);

                await createBillingDm({
                    supabase,
                    senderAddress: merchantAddress,
                    receiverAddress: subscriber,
                    messageType: "DEBIT_SUCCESS",
                    amountUsdc: amountOnChain,
                    title: "Subscription renewed",
                    description: [
                        "Your subscription was renewed successfully.",
                        `Amount: ${Number(amountOnChain) / 1_000_000} USDC`,
                        `Subscription ID: ${subId}`,
                    ].join("\n"),
                    txHash: tx.hash,
                }).catch((e: any) => console.error("[customer-billing] receipt DM failed:", e));

                await dispatchMerchantWebhook(merchantAddress, "subscription.renewed", subscriptionWebhookData({
                    subscriptionId: subId,
                    status: "active",
                    amountUsdcMicros: amountOnChain,
                    subscriber,
                    merchantAddress,
                    txHash: tx.hash,
                    beneficiary: sub.beneficiary_address || null,
                })).catch(() => { /* best-effort */ });

                results.push({ subId, subscriber, action: "PAYMENT_EXECUTED", success: true, txHash: tx.hash });
            } catch (err: any) {
                console.error(`[customer-billing] requestId: ${requestId}, sub ${subId} failed:`, err);
                results.push({ subId, action: "EXECUTION_FAILED", success: false, error: err?.message || "Unknown error" });
            }
        }

        /* Deferred cancellations: subs the user cancelled "at period end" whose paid period has now
           elapsed. Perform the on-chain cancel (server-signed from the subscriber's embedded wallet)
           so access ends exactly when their paid days run out. */
        const cancelResults: any[] = [];
        const { data: dueCancels, error: dueCancelError } = await supabase
            .from("subscriptions")
            .select("subscription_id, merchant_address")
            .eq("kind", "CUSTOMER")
            .eq("status", "ACTIVE")
            .eq("cancel_at_period_end", true)
            .lte("next_billing_date", new Date().toISOString());

        if (dueCancelError) {
            console.error("[customer-billing] due-cancel query failed:", dueCancelError.message);
        } else {
            for (const sub of dueCancels || []) {
                const subId = Number(sub.subscription_id);
                try {
                    const onChain = await standardContract.subscriptions(subId);
                    const subscriber: string = onChain[0];
                    const amount: bigint = BigInt(onChain[2]);
                    const isActiveOnChain: boolean = onChain[5];

                    if (isActiveOnChain) {
                        await ensureGasSponsored(subscriber.toLowerCase()).catch(() => { /* best-effort */ });
                        await cancelFromEmbedded(subscriber, BigInt(subId));
                    }

                    await supabase
                        .from("subscriptions")
                        .update({ status: "CANCELED", updated_at: new Date().toISOString() })
                        .eq("subscription_id", subId);

                    await dispatchMerchantWebhook(sub.merchant_address, "subscription.canceled", subscriptionWebhookData({
                        subscriptionId: subId,
                        status: "canceled",
                        amountUsdcMicros: amount,
                        subscriber,
                        merchantAddress: sub.merchant_address,
                        reason: "Canceled at period end",
                    })).catch(() => { /* best-effort */ });

                    cancelResults.push({ subId, action: "CANCELED_AT_PERIOD_END", success: true });
                } catch (err: any) {
                    /* Keep the subscription ACTIVE with cancel_at_period_end set so the next run
                       retries. Reporting CANCELED while authorization remains active on-chain can
                       hide a chargeable subscription from both the user and operations. */
                    console.error(`[customer-billing] period-end cancel for sub ${subId} failed:`, err?.message || err);
                    cancelResults.push({ subId, action: "CANCEL_AT_PERIOD_END_FAILED", success: false, error: err?.message || "Unknown error" });
                }
            }
        }

        const success = results.every((result) => result.success) && cancelResults.every((result) => result.success);
        return NextResponse.json(
            { success, processed: results.length, results, cancellations: cancelResults },
            { status: success ? 200 : 500 }
        );
    } catch (error: any) {
        console.error("Customer billing keeper error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
