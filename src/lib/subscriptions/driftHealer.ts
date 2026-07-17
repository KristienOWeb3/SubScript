/* On-chain ↔ DB drift healer for the subscriptions mirror.
 *
 * The mirror is write-through: our own routes/crons keep it accurate for everything THEY do,
 * but the contract is permissionless — a third party can execute a due payment, and a user can
 * cancel straight from a block explorer. Nothing syncs those until our code happens to touch
 * the same subscription. This healer closes that gap on the daily reconcile schedule:
 *
 *   1. DB says ACTIVE/PAST_DUE, chain says inactive  → mirror the cancel (status CANCELED
 *      + webhook), so the app never shows a live plan for a dead authorization.
 *   2. DB says CANCELED, chain says active           → the dangerous direction: the user
 *      believes billing stopped but the authorization is still chargeable. Re-attempt the
 *      on-chain cancel from the subscriber's embedded wallet; external wallets get an
 *      advisory DM instead (we cannot sign for them).
 *   3. DB billing timestamp is stale for an executed period → someone else executed the due
 *      sequence. Stamp last_settlement_timestamp with that sequence's due time so the DB
 *      trigger derives the correct next_billing_date and our keeper doesn't re-attempt.
 *
 * Read-bounded: every run processes at most `limit` subscriptions (RPC reads are the cost),
 * oldest-checked first, so the whole book is swept across a few daily runs even if it grows.
 */
import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { cancelFromEmbedded } from "@/lib/subscriptions/onchain";
import { ensureSponsoredGas } from "@/lib/sponsor/sponsorship";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { insertSupabaseDmAndNotify } from "@/lib/dms/notifications";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
    "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)",
];

type DriftResult = {
    subId: number;
    action:
        | "MIRRORED_ONCHAIN_CANCEL"
        | "REVOKED_STALE_AUTHORIZATION"
        | "ADVISED_EXTERNAL_REVOKE"
        | "HEALED_SETTLEMENT_TIMESTAMP"
        | "REVOKE_FAILED";
    detail?: string;
};

export async function healSubscriptionDrift(
    supabase: any,
    limit = 60,
): Promise<{ checked: number; healed: DriftResult[]; errors: number }> {
    const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, STANDARD_ABI, provider);

    const healed: DriftResult[] = [];
    let checked = 0;
    let errors = 0;

    /* Live rows get the larger share of the read budget; recently-cancelled rows get the rest
       (an old CANCELED row that already passed a drift check doesn't need rechecking forever —
       14 days covers retries around the cancel itself). */
    const liveBudget = Math.ceil(limit * 0.75);
    const cancelledBudget = limit - liveBudget;

    const { data: liveSubs, error: liveErr } = await supabase
        .from("subscriptions")
        .select("subscription_id, merchant_address, status, amount_cap_usdc, last_settlement_timestamp, updated_at")
        .in("status", ["ACTIVE", "PAST_DUE"])
        .order("updated_at", { ascending: true })
        .limit(liveBudget);
    if (liveErr) throw new Error(`drift-healer live query failed: ${liveErr.message}`);

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cancelledSubs, error: cancErr } = await supabase
        .from("subscriptions")
        .select("subscription_id, merchant_address, status, amount_cap_usdc, updated_at")
        .eq("status", "CANCELED")
        .gte("updated_at", fourteenDaysAgo)
        .order("updated_at", { ascending: true })
        .limit(cancelledBudget);
    if (cancErr) throw new Error(`drift-healer cancelled query failed: ${cancErr.message}`);

    for (const sub of [...(liveSubs || []), ...(cancelledSubs || [])]) {
        const subId = Number(sub.subscription_id);
        if (!Number.isFinite(subId) || subId <= 0) continue;
        checked++;
        try {
            const onChain = await contract.subscriptions(subId);
            const subscriber: string = String(onChain[0]).toLowerCase();
            const period: bigint = BigInt(onChain[3]);
            const nextPayment: bigint = BigInt(onChain[4]);
            const isActiveOnChain: boolean = Boolean(onChain[5]);

            /* A zero subscriber means the id was never created on-chain — a mirror-only row
               (e.g. seeded/test data). Nothing on-chain to reconcile against. */
            if (subscriber === ethers.ZeroAddress.toLowerCase()) continue;

            if ((sub.status === "ACTIVE" || sub.status === "PAST_DUE") && !isActiveOnChain) {
                /* Case 1: cancelled on-chain behind our back — mirror it. */
                await supabase
                    .from("subscriptions")
                    .update({ status: "CANCELED", updated_at: new Date().toISOString() })
                    .eq("subscription_id", subId);
                await dispatchDurableSubscriptionWebhook(sub.merchant_address, "subscription.canceled", subscriptionWebhookData({
                    subscriptionId: subId,
                    status: "canceled",
                    amountUsdcMicros: sub.amount_cap_usdc || 0,
                    subscriber,
                    merchantAddress: sub.merchant_address,
                    reason: "Canceled on-chain (reconciled)",
                }), `drift-canceled:${subId}`);
                healed.push({ subId, action: "MIRRORED_ONCHAIN_CANCEL" });
                continue;
            }

            if (sub.status === "CANCELED" && isActiveOnChain) {
                /* Case 2: DB cancelled but the authorization is still live — revoke it. */
                try {
                    await ensureSponsoredGas({
                        wallet: subscriber,
                        action: "drift_heal",
                        requestKey: `drift-revoke:${subId}`,
                    }).catch(() => { /* best-effort */ });
                    const txHash = await cancelFromEmbedded(subscriber, BigInt(subId));
                    healed.push({ subId, action: "REVOKED_STALE_AUTHORIZATION", detail: txHash });
                } catch (revokeErr: any) {
                    const { data: walletRow } = await supabase
                        .from("user_embedded_wallets")
                        .select("provider")
                        .eq("wallet_address", subscriber)
                        .maybeSingle();
                    if (walletRow?.provider === "external_wallet") {
                        await insertSupabaseDmAndNotify(supabase, {
                            sender_address: String(sub.merchant_address).toLowerCase(),
                            receiver_address: subscriber,
                            message_type: "EXPIRY_WARNING",
                            status: "PENDING",
                            amount_usdc: String(sub.amount_cap_usdc || 0),
                            title: "Action needed: revoke subscription authorization",
                            description: [
                                "This subscription is cancelled in SubScript, but its on-chain authorization is still active.",
                                "Because your wallet is externally controlled, SubScript cannot revoke it for you.",
                                `Please call cancelSubscription(${subId}) on the SubScript contract or revoke its USDC allowance from your wallet.`,
                            ].join("\n"),
                            tx_hash: null,
                        }).catch(() => { /* best-effort */ });
                        healed.push({ subId, action: "ADVISED_EXTERNAL_REVOKE" });
                    } else {
                        healed.push({ subId, action: "REVOKE_FAILED", detail: revokeErr?.message || "unknown" });
                        errors++;
                    }
                }
                /* Touch updated_at so this row rotates to the back of the sweep either way. */
                await supabase
                    .from("subscriptions")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("subscription_id", subId);
                continue;
            }

            if ((sub.status === "ACTIVE" || sub.status === "PAST_DUE") && isActiveOnChain && period > BigInt(0)) {
                /* Case 3: the latest due sequence was executed (possibly not by us) but the DB
                   still thinks that period is unpaid. due(seq) = nextPayment + (seq-1)*period. */
                const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
                if (nowSeconds >= nextPayment) {
                    const latestDueSeq = Number((nowSeconds - nextPayment) / period) + 1;
                    const dueTimeSeconds = nextPayment + BigInt(latestDueSeq - 1) * period;
                    const dueTime = new Date(Number(dueTimeSeconds) * 1000);
                    const lastSettlement = sub.last_settlement_timestamp ? new Date(sub.last_settlement_timestamp) : null;
                    const dbThinksUnpaid = !lastSettlement || lastSettlement < dueTime;
                    if (dbThinksUnpaid && (await contract.isSequenceExecuted(subId, latestDueSeq))) {
                        await supabase
                            .from("subscriptions")
                            .update({
                                status: "ACTIVE",
                                downgrade_failures: 0,
                                last_settlement_timestamp: dueTime.toISOString(),
                                updated_at: new Date().toISOString(),
                            })
                            .eq("subscription_id", subId);
                        healed.push({ subId, action: "HEALED_SETTLEMENT_TIMESTAMP", detail: dueTime.toISOString() });
                        continue;
                    }
                }
                /* No drift: rotate the row to the back of the sweep so the read budget covers
                   the whole book across runs. */
                await supabase
                    .from("subscriptions")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("subscription_id", subId);
            }
        } catch (err: any) {
            errors++;
            console.error(`[drift-healer] sub ${subId} check failed:`, err?.message || err);
        }
    }

    return { checked, healed, errors };
}
