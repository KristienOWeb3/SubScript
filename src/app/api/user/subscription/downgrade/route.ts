/* Switch a subscription to a cheaper plan (or a different billing interval at an equal or lower
 * rate), taking effect at the next renewal.
 *
 * One atomic `replaceSubscription` (PSA v3) with no charge today. The new authorization's first
 * charge is deferred to the current paid-through date, so the subscriber keeps everything they
 * already paid for and is never refunded or charged mid-period. The unused value of the current
 * window is recorded as carried credit on the new row, so a later upgrade during that window still
 * credits the time the subscriber paid for at the old price.
 *
 * GET previews the change for the checkout page. POST performs it. Custodial wallets are
 * server-signed. External wallets get the exact call to sign, then post the hash.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";

import { financialPinContext } from "@/lib/auth/financialPinPolicy";
import { withTransactionPin } from "@/lib/auth/transactionPin";
import { getSessionWallet } from "@/lib/auth";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { requireAccountRole } from "@/lib/accounts/roles";
import { haltGuard } from "@/lib/accountHalt";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { createSubscriptionStartedDm, formatUsdcFromMicros } from "@/lib/dms/system";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { prisma } from "@/lib/prisma";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { onActiveContract, subscriptionKey } from "@/lib/subscriptions/contractBinding";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import {
    findActiveOnChainSubscriptionIdOrNull,
    getSubscriptionOnChain,
    getSubscriptionPaidThrough,
    horizonAllowance,
    replaceFromEmbedded,
    replaceSubscriptionArgs,
    supportsReplaceSubscriptions,
    verifyExternalReplaceTx,
    type ReplaceTerms,
} from "@/lib/subscriptions/onchain";
import { creditBasisForRow, unusedWindowValueMicros } from "@/lib/subscriptions/planChange";
import { compareRecurringRates } from "@/lib/subscriptions/planComparison";
import { resolveUpgradeTarget, type Refusal, type UpgradeTarget } from "@/lib/subscriptions/planTarget";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { sanitizeInput } from "@/utils/security";

export const maxDuration = 120;

/* The contract needs the deferred first charge strictly in the future. A minute of headroom keeps a
   change requested at the very end of a period from reverting on block time. */
const MIN_REMAINING_SECONDS = BigInt(60);

type ResolvedDowngrade = {
    merchant: string;
    target: UpgradeTarget;
    current: NonNullable<Awaited<ReturnType<typeof prisma.subscription.findFirst>>>;
    fromSubscriptionId: string;
    paidThroughSeconds: bigint;
    carriedMicros: bigint;
    replaceTerms: ReplaceTerms;
};

async function requireSubscriber(request: Request): Promise<{ ok: true; subscriber: string } | Refusal> {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) return { ok: false, status: 401, body: { error: "Unauthorized" } };
    const roleCheck = await requireAccountRole(wallet, "USER");
    if (!roleCheck.ok) return { ok: false, status: roleCheck.status, body: { error: roleCheck.error } };
    return { ok: true, subscriber: wallet.toLowerCase() };
}

async function resolveDowngrade(
    subscriber: string,
    id: string,
    now = new Date(),
): Promise<{ ok: true; value: ResolvedDowngrade } | Refusal> {
    if (!id) return { ok: false, status: 400, body: { error: "planId is required" } };
    const targetResult = await resolveUpgradeTarget(id, subscriber);
    if (!targetResult.ok) return targetResult;
    const target = targetResult.value;
    const merchant = target.merchantAddress.toLowerCase();

    const current = await prisma.subscription.findFirst({
        where: {
            ...onActiveContract(),
            subscriber,
            merchantAddress: merchant,
            kind: "CUSTOMER",
            status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
    });
    if (!current) {
        return {
            ok: false,
            status: 409,
            body: {
                error: "You don't have an active subscription with this merchant to switch. Subscribe to this plan instead.",
                code: "NO_ACTIVE_SUBSCRIPTION",
            },
        };
    }

    const fromSubscriptionId = String(current.subscriptionId);
    const onChain = await getSubscriptionOnChain(fromSubscriptionId);
    if (!onChain) {
        return { ok: false, status: 503, body: { error: "We couldn't read your subscription on-chain. Try again in a moment.", code: "CHAIN_READ_FAILED" } };
    }
    if (onChain.subscriber !== subscriber || onChain.merchant !== merchant) {
        return { ok: false, status: 404, body: { error: "Subscription not found for this account" } };
    }
    if (!onChain.isActive) {
        return {
            ok: false,
            status: 409,
            body: {
                error: "This subscription is canceled. Resume it first, then switch plans.",
                code: "RESUME_BEFORE_CHANGE",
                subscriptionId: fromSubscriptionId,
            },
        };
    }

    if (target.amountUsdc === onChain.amount && target.periodSeconds === onChain.period) {
        return { ok: false, status: 409, body: { error: "You're already on this plan.", code: "NO_CHANGE" } };
    }
    /* A higher recurring rate is an upgrade: it takes effect now and is prorated, so it belongs to
       the upgrade route. Everything else (cheaper, or a different interval at an equal or lower
       rate) switches at renewal. */
    if (compareRecurringRates(target.amountUsdc, target.periodSeconds, onChain.amount, onChain.period) > 0) {
        return {
            ok: false,
            status: 409,
            body: { error: "That plan costs more, so it's an upgrade. Upgrade to switch now.", code: "USE_UPGRADE" },
        };
    }

    const paidThroughSeconds = await getSubscriptionPaidThrough(fromSubscriptionId, onChain);
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    if (paidThroughSeconds - nowSeconds < MIN_REMAINING_SECONDS) {
        return {
            ok: false,
            status: 409,
            body: { error: "Your current period is just ending. Try again in a few minutes, once it has renewed.", code: "PERIOD_ENDING" },
        };
    }

    const basis = await creditBasisForRow(fromSubscriptionId, onChain, paidThroughSeconds, current);
    const carriedMicros = unusedWindowValueMicros(basis, paidThroughSeconds, nowSeconds);

    return {
        ok: true,
        value: {
            merchant,
            target,
            current,
            fromSubscriptionId,
            paidThroughSeconds,
            carriedMicros,
            replaceTerms: {
                newAmount: target.amountUsdc,
                newPeriod: target.periodSeconds,
                chargeNow: BigInt(0),
                firstPaymentAt: paidThroughSeconds,
                introCycles: BigInt(0),
            },
        },
    };
}

/* GET /api/user/subscription/downgrade?planId=... Read-only preview. `downgrade: false` (not an
   error) when there is nothing to switch, so the page can fall through to subscribe or upgrade. */
export async function GET(request: Request) {
    try {
        const auth = await requireSubscriber(request);
        if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
        const planId = new URL(request.url).searchParams.get("planId")?.trim() || "";
        const resolved = await resolveDowngrade(auth.subscriber, planId);
        if (!resolved.ok) {
            return NextResponse.json({ success: true, downgrade: false, ...resolved.body }, { status: 200 });
        }
        const { target, paidThroughSeconds, fromSubscriptionId } = resolved.value;
        return NextResponse.json({
            success: true,
            downgrade: true,
            planName: target.name,
            fromSubscriptionId,
            newAmountUsdc: formatUsdcFromMicros(target.amountUsdc),
            chargedNowUsdc: "0.00",
            effectiveAt: new Date(Number(paidThroughSeconds) * 1000).toISOString(),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Downgrade preview failed:", error);
        return NextResponse.json({ error: error.message || "Failed to price this plan change" }, { status: 500 });
    }
}

async function handlePOST(request: Request) {
    try {
        const auth = await requireSubscriber(request);
        if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
        const subscriber = auth.subscriber;

        const held = await haltGuard(subscriber);
        if (held) return held;
        try {
            assertFinancialNetworkReady();
        } catch (networkError) {
            console.error("[subscription/downgrade] financial network is not ready:", networkError);
            return NextResponse.json({ error: "Subscriptions are temporarily unavailable." }, { status: 503 });
        }
        if (!await supportsReplaceSubscriptions()) {
            return NextResponse.json({
                error: "Plan switches need the updated subscription contract, which isn't live yet. Your current plan is unchanged.",
                code: "CONTRACT_UPGRADE_REQUIRED",
            }, { status: 503 });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId.trim() : "";
        const resolved = await resolveDowngrade(subscriber, planId);
        if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
        const { merchant, target, current, fromSubscriptionId, paidThroughSeconds, carriedMicros, replaceTerms } = resolved.value;

        const custodial = isCustodialWallet(await getWalletCustody(subscriber));
        const externalTxHash = typeof body.txHash === "string" ? body.txHash : null;
        if (!custodial && !externalTxHash) {
            return NextResponse.json({
                requiresWalletSignature: true,
                contractAddress: STANDARD_CONTRACT_ADDRESS,
                functionName: "replaceSubscription",
                args: replaceSubscriptionArgs(fromSubscriptionId, replaceTerms).map(String),
                allowanceUsdcMicros: horizonAllowance(replaceTerms.newAmount, replaceTerms.newPeriod).toString(),
                chargedNowUsdc: "0.00",
                error: "Confirm the plan switch in your connected wallet. Nothing is charged today.",
            }, { status: 409 });
        }
        if (!custodial && !/^0x[0-9a-fA-F]{64}$/.test(externalTxHash || "")) {
            return NextResponse.json({ error: "A valid confirmed plan-change transaction hash is required." }, { status: 400 });
        }

        /* Same lock key as subscribe, resume and upgrade, so no two of them interleave for one
           (subscriber, merchant). The attempt row keys this exact change for idempotency. */
        const lockKey = `customer-subscription:${subscriber}:${merchant}`;
        const idempotencyKey = `downgrade:${current.contractAddress}:${fromSubscriptionId}:${target.id}`;
        const providerIdempotencyKey = deterministicIdempotencyKey(idempotencyKey);
        const requestFingerprint = crypto.createHash("sha256")
            .update(`${idempotencyKey}:${replaceTerms.newAmount}:${replaceTerms.newPeriod}:${paidThroughSeconds}`)
            .digest("hex");
        const claim = await prisma.$transaction(async (tx) => {
            const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
                SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
            `;
            if (!(lockRows?.[0]?.acquired ?? false)) return "CONCURRENT" as const;
            const where = { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } };
            const existing = await tx.subscriptionAttempt.findUnique({ where });
            if (existing) {
                if (existing.status !== "FAILED") return "ATTEMPT_EXISTS" as const;
                await tx.subscriptionAttempt.update({ where, data: { status: "PREPARED", requestFingerprint } });
                return "NEW" as const;
            }
            await tx.subscriptionAttempt.create({
                data: {
                    merchantAddress: merchant, subscriberAddress: subscriber, idempotencyKey,
                    requestFingerprint, providerIdempotencyKey, status: "PREPARED",
                },
            });
            return "NEW" as const;
        }).catch((error: unknown) => {
            console.error("[subscription/downgrade] claim transaction failed:", error);
            return "CONCURRENT" as const;
        });
        if (claim === "CONCURRENT") {
            return NextResponse.json({ error: "Another change to this subscription is in progress. Try again shortly.", code: "CONCURRENT_REQUEST" }, { status: 409 });
        }
        if (claim === "ATTEMPT_EXISTS") {
            return NextResponse.json({ error: "This plan switch has already been submitted. Refresh to see its current state.", code: "CHANGE_IN_PROGRESS" }, { status: 409 });
        }
        const markAttempt = (status: string, txHashValue?: string | null) => prisma.subscriptionAttempt.update({
            where: { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } },
            data: {
                status,
                ...(txHashValue ? { txHash: txHashValue } : {}),
                ...(status === "PAID" ? { completedAt: new Date() } : {}),
            },
        }).catch(() => {});

        let txHash: string | null;
        let newSubscriptionId: string | null;
        if (!custodial) {
            try {
                ({ txHash, subId: newSubscriptionId } = await verifyExternalReplaceTx({
                    txHash: externalTxHash!, subscriber, oldSubId: fromSubscriptionId, terms: replaceTerms,
                }));
            } catch (verifyError) {
                await markAttempt("FAILED");
                return NextResponse.json({
                    error: verifyError instanceof Error ? verifyError.message : "We couldn't verify that plan switch.",
                    code: "EXTERNAL_REPLACE_UNVERIFIED",
                }, { status: 400 });
            }
        } else {
            await requireSponsoredGas({ wallet: subscriber, action: "subscribe", requestKey: idempotencyKey });
            try {
                ({ txHash, subId: newSubscriptionId } = await replaceFromEmbedded(
                    subscriber, fromSubscriptionId, replaceTerms, providerIdempotencyKey,
                ));
            } catch (replaceError) {
                const after = await getSubscriptionOnChain(fromSubscriptionId);
                if (after?.isActive) {
                    await markAttempt("FAILED");
                    return NextResponse.json({
                        error: "The plan switch didn't go through. Your current plan is unchanged, so you can try again.",
                        code: "CHANGE_FAILED",
                    }, { status: 502 });
                }
                console.error("[subscription/downgrade] replace returned an error but may have landed:", replaceError);
                txHash = null;
                newSubscriptionId = after
                    ? await findActiveOnChainSubscriptionIdOrNull(subscriber, merchant).catch(() => null)
                    : null;
            }
        }

        if (!newSubscriptionId) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-downgrade-id:${fromSubscriptionId}:${target.id}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "downgrade replace may have landed on-chain but the new subscription id could not be recovered",
                context: { fromSubscriptionId, planId: target.id, merchant, subscriber, txHash },
            }).catch(() => {});
            await markAttempt("RECONCILIATION_REQUIRED", txHash);
            return NextResponse.json({
                error: "Your plan switch is on-chain but still reconciling. Refresh in a moment and don't submit it again.",
                code: "RECONCILIATION_PENDING",
                txHash,
            }, { status: 202 });
        }

        const effectiveAt = new Date(Number(paidThroughSeconds) * 1000);
        const commitmentRemainingSeconds = current.minCommitmentUntil
            ? Math.max(0, Math.floor((current.minCommitmentUntil.getTime() - Date.now()) / 1000))
            : 0;
        try {
            await mirrorSubscriptionCreated({
                subscriptionId: newSubscriptionId,
                merchantAddress: merchant,
                subscriber,
                amountUsdc: replaceTerms.newAmount,
                periodSeconds: replaceTerms.newPeriod,
                beneficiaryAddress: current.beneficiaryAddress,
                minCommitmentSeconds: BigInt(commitmentRemainingSeconds),
                promotion: null,
                /* The first charge is the deferred one, at the old paid-through date. */
                anchorNextPaymentSeconds: paidThroughSeconds,
                externalReference: current.externalReference,
                sourceCheckoutId: target.checkoutSessionId ?? current.sourceCheckoutId,
                planId: target.planId ?? current.planId,
                carriedCredit: { micros: carriedMicros, since: new Date() },
            });
        } catch (mirrorError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-downgrade-mirror:${fromSubscriptionId}:${newSubscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "downgrade replaced the authorization on-chain but the new mirror row could not be written",
                context: { fromSubscriptionId, newSubscriptionId, planId: target.id, merchant, subscriber, txHash },
                error: mirrorError,
            }).catch(() => {});
            await markAttempt("RECONCILIATION_REQUIRED", txHash);
            return NextResponse.json({
                error: "Your plan switch went through but is still being recorded. Refresh in a moment and don't submit it again.",
                code: "RECONCILIATION_PENDING",
                subscriptionId: newSubscriptionId,
                txHash,
            }, { status: 202 });
        }

        try {
            await prisma.subscription.update({
                where: subscriptionKey(current.subscriptionId, current.contractAddress),
                data: { status: "CANCELED", revocationPending: false, revocationTxHash: txHash, updatedAt: new Date() },
            });
        } catch (closeError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-downgrade-close:${fromSubscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "downgrade mirrored the new authorization but could not close the superseded row",
                context: { fromSubscriptionId, newSubscriptionId, merchant, subscriber },
                error: closeError,
            }).catch(() => {});
        }
        await markAttempt("PAID", txHash);

        await createSubscriptionStartedDm({
            merchantAddress: merchant,
            subscriberAddress: subscriber,
            planName: target.name,
            amountUsdc: replaceTerms.newAmount,
            periodSeconds: replaceTerms.newPeriod,
            isChange: true,
            changeTerms: { effective: "next_renewal", nextBillingDate: effectiveAt },
        }).catch((err) => console.error("[subscription/downgrade] DM failed:", err));

        try {
            await dispatchDurableSubscriptionWebhook(merchant, "subscription.updated", {
                ...subscriptionWebhookData({
                    subscriptionId: newSubscriptionId,
                    status: "active",
                    amountUsdcMicros: replaceTerms.newAmount,
                    subscriber,
                    merchantAddress: merchant,
                    txHash: txHash ?? undefined,
                    beneficiary: current.beneficiaryAddress,
                    externalReference: current.externalReference,
                    sourceCheckoutId: target.checkoutSessionId ?? current.sourceCheckoutId,
                    reason: "Plan switched by subscriber; takes effect at next renewal",
                }),
                plan_id: target.planId ?? current.planId,
                planId: target.planId ?? current.planId,
                previous_subscription_id: `sub_${fromSubscriptionId}`,
                previousSubscriptionId: `sub_${fromSubscriptionId}`,
                effective: "next_renewal",
                effective_at: effectiveAt.toISOString(),
                effectiveAt: effectiveAt.toISOString(),
                prorated_charge_usdc_micros: "0",
                proratedChargeUsdcMicros: "0",
                current_period_end: effectiveAt.toISOString(),
                currentPeriodEnd: effectiveAt.toISOString(),
            }, `customer-downgraded:${newSubscriptionId}`);
        } catch (webhookError) {
            console.error("[ALERT] downgrade webhook enqueue failed after state committed:", webhookError);
        }

        return NextResponse.json({
            success: true,
            switched: true,
            subscriptionId: newSubscriptionId,
            previousSubscriptionId: fromSubscriptionId,
            planName: target.name,
            chargedNowUsdc: "0.00",
            effectiveAt: effectiveAt.toISOString(),
            txHash,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Downgrade subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to switch plans" }, { status: 500 });
    }
}

export const POST = withTransactionPin({ action: "subscription-downgrade", bind: financialPinContext }, handlePOST);
