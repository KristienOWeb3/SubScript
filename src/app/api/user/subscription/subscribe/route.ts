/* User subscribes to a merchant plan from within a DM. Server-signed from the embedded
   wallet; gas covered by SubScript (Pay For Me). Takes the first payment immediately. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { subscribeFromEmbedded, findActiveOnChainSubscriptionId } from "@/lib/subscriptions/onchain";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { createSubscriptionStartedDm } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        /* Sponsored subscription ("Pay for Me"): the caller pays, someone else receives the
           service. The beneficiary rides the mirror + merchant webhooks for entitlement mapping;
           billing, cancellation rights, and on-chain authorization stay with the payer. */
        let beneficiaryAddress: string | null = null;
        if (body.beneficiaryAddress !== undefined && body.beneficiaryAddress !== null && body.beneficiaryAddress !== "") {
            if (typeof body.beneficiaryAddress !== "string" || !ethers.isAddress(body.beneficiaryAddress)) {
                return NextResponse.json({ error: "beneficiaryAddress must be a valid 0x address" }, { status: 400 });
            }
            beneficiaryAddress = body.beneficiaryAddress.toLowerCase();
            if (beneficiaryAddress === wallet.toLowerCase()) beneficiaryAddress = null;
        }

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || !plan.active) {
            return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
        }
        if (!ethers.isAddress(plan.merchantAddress)) {
            return NextResponse.json({ error: "Plan has an invalid merchant" }, { status: 400 });
        }

        const subscriber = wallet.toLowerCase();
        const merchant = plan.merchantAddress.toLowerCase();
        const lockKey = `customer-subscription:${subscriber}:${merchant}`;

        /* Serialize subscription creation per user + merchant. Without this database-backed lock,
           two fast clicks can both pass the duplicate check before either on-chain transaction is
           mirrored. The second request waits, then sees the first active subscription. */
        return await withPgClient(async (client) => {
            await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
            try {
                const existingResult = await client.query(
                    `select subscription_id, amount_cap_usdc, billing_interval_seconds
                       from subscriptions
                      where subscriber = $1
                        and merchant_address = $2
                        and kind = 'CUSTOMER'
                        and status in ('ACTIVE', 'PAST_DUE')
                      order by created_at desc
                      limit 1`,
                    [subscriber, merchant]
                );
                const existing = existingResult.rows[0];
                if (existing) {
                    const isSamePlan =
                        String(existing.amount_cap_usdc) === plan.amountUsdc.toString()
                        && String(existing.billing_interval_seconds) === plan.periodSeconds.toString();
                    return NextResponse.json({
                        error: isSamePlan
                            ? "You are already subscribed to this plan."
                            : "You already have an active subscription with this merchant. Manage that plan from your dashboard.",
                        code: isSamePlan ? "ALREADY_SUBSCRIBED" : "ACTIVE_MERCHANT_SUBSCRIPTION",
                        subscriptionId: String(existing.subscription_id),
                    }, { status: 409 });
                }

                /* Belt-and-suspenders: the mirror check above only sees subs we mirrored. Scan the
                   chain for an already-active sub from this subscriber to this merchant so an
                   unmirrored on-chain sub can't be duplicated. Best-effort (null on RPC error). */
                const onChainActiveId = await findActiveOnChainSubscriptionId(subscriber, merchant);
                if (onChainActiveId) {
                    return NextResponse.json({
                        error: "You already have an active subscription with this merchant. Manage that plan from your dashboard.",
                        code: "ACTIVE_MERCHANT_SUBSCRIPTION",
                        subscriptionId: onChainActiveId,
                    }, { status: 409 });
                }

                await requireGasSponsored(subscriber);
                const { txHash, subId } = await subscribeFromEmbedded(
                    subscriber,
                    merchant,
                    plan.amountUsdc,
                    plan.periodSeconds
                );

                /* Mirror before releasing the advisory lock, so the next request observes this
                   active subscription and cannot create a duplicate. */
                if (subId) {
                    await mirrorSubscriptionCreated({
                        subscriptionId: subId,
                        merchantAddress: merchant,
                        subscriber,
                        amountUsdc: plan.amountUsdc,
                        periodSeconds: plan.periodSeconds,
                        beneficiaryAddress,
                        minCommitmentSeconds: plan.minCommitmentSeconds,
                    });
                }

                /* Open the merchant→user DM thread for this subscription (best-effort). */
                await createSubscriptionStartedDm({
                    merchantAddress: merchant,
                    subscriberAddress: subscriber,
                    planName: plan.name,
                    amountUsdc: plan.amountUsdc,
                    periodSeconds: plan.periodSeconds,
                }).catch((err) => console.error("[subscription/subscribe] DM creation failed:", err));

                return NextResponse.json({
                    success: true,
                    txHash,
                    subscriptionId: subId,
                    planName: plan.name,
                }, { status: 200 });
            } finally {
                await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
                    .catch((unlockError: unknown) =>
                        console.error("[subscription/subscribe] advisory unlock failed:", unlockError)
                    );
            }
        });
    } catch (error: any) {
        console.error("Subscribe failed:", error);
        return NextResponse.json({ error: error.message || "Failed to subscribe" }, { status: 500 });
    }
}
