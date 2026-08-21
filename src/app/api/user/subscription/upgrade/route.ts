/* Upgrade a subscription to a higher-rate plan, settled from the hosted subscription checkout.
 *
 * Not an in-place modify. `modifySubscription` rejects a rate reduction by cross-multiplying the new
 * terms against the authorization's CURRENT on-chain period, and after a resume that period is the
 * short bridge period rather than the plan cadence — so a genuine upgrade (20 USDC/30d to 40 USDC/30d
 * with 14 days left: `40 * 14 < 20 * 30`) reverts on-chain, and the bridge period can never be
 * restored because restoring it reads as a reduction too. So an upgrade revokes the old authorization
 * and mints a fresh one at the new plan's real terms, where no such comparison exists.
 *
 * The subscriber pays the new plan's price minus credit for the time they already paid for, taken as
 * the new authorization's sequence-0 charge. See lib/subscriptions/upgradeCheckout for the arithmetic
 * and why it is NOT proratedUpgradeDelta.
 *
 * Ordering is cancel-then-create, deliberately. `executePayment` is permissionless, so an authorization
 * left `isActive` stays chargeable no matter what the database says — and the contract's duplicate
 * guard is keyed on the full (subscriber, merchant, amount, period, tokens) tuple, so a NEW
 * amount/period is not a duplicate and both authorizations would be live at once. Creating first would
 * leave the subscriber holding two chargeable authorizations; cancelling first can only leave them
 * holding none, which `/api/user/subscription/resume` recovers for free because cancellation leaves the
 * authorization struct (and its paid-through date) intact.
 *
 * GET previews the terms for the checkout page. The money math is computed server-side in both verbs
 * from the same resolver, so the figure the subscriber is shown is the figure that gets charged — the
 * client never derives it.
 *
 * Server-signed from the embedded wallet; gas covered by SubScript.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import {
    cancelFromEmbedded,
    getSubscriptionOnChain,
    subscribeFromEmbedded,
} from "@/lib/subscriptions/onchain";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import {
    mirrorSubscriptionCreated,
    mirrorSubscriptionCancelAtPeriodEnd,
} from "@/lib/subscriptions/mirror";
import { onActiveContract, subscriptionKey } from "@/lib/subscriptions/contractBinding";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";
import { checkoutExpiresAt, isCheckoutExpired } from "@/lib/subscriptions/apiSubscriptionView";
import {
    upgradeCheckoutTerms,
    type UpgradeCheckoutTerms,
} from "@/lib/subscriptions/upgradeCheckout";
import { createSubscriptionStartedDm, formatUsdcFromMicros } from "@/lib/dms/system";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { haltGuard } from "@/lib/accountHalt";
import { deterministicIdempotencyKey } from "@/lib/custody";

export const maxDuration = 120;

type UpgradeTarget = {
    /** The id the caller arrived with — a plan id or a subscription-checkout id. */
    id: string;
    merchantAddress: string;
    name: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    /** Set when the target was a checkout session rather than a catalog plan. */
    checkoutSessionId: string | null;
    /** The catalog plan this target belongs to, when one exists, for the mirror's plan_id. */
    planId: string | null;
};

type ResolvedUpgrade = {
    merchant: string;
    target: UpgradeTarget;
    current: NonNullable<Awaited<ReturnType<typeof prisma.subscription.findFirst>>>;
    fromSubscriptionId: string;
    onChain: NonNullable<Awaited<ReturnType<typeof getSubscriptionOnChain>>>;
    newAmountMicros: bigint;
    newPeriodSeconds: bigint;
    terms: UpgradeCheckoutTerms;
};

type Refusal = { ok: false; status: number; body: Record<string, unknown> };

/**
 * Resolve the plan being upgraded to, from either identifier the customer can arrive with.
 *
 * A business that links its own pricing page at SubScript sends customers to `/subscribe/<id>`, and
 * that id is a catalog plan for a dashboard-published plan but a `payment_links` row for one created
 * through `POST /api/v1/subscriptions`. Accepting only the former meant an upgrade started from the
 * merchant's own site — the entry point this flow exists for — failed with "Plan not found".
 */
async function resolveUpgradeTarget(
    id: string,
    subscriber: string,
): Promise<{ ok: true; value: UpgradeTarget } | Refusal> {
    const plan = await prisma.merchantPlan.findUnique({ where: { id } });
    if (plan) {
        if (!plan.active) {
            return { ok: false, status: 404, body: { error: "Plan not found or inactive" } };
        }
        if (plan.targetSubscriber && plan.targetSubscriber.toLowerCase() !== subscriber) {
            return { ok: false, status: 403, body: { error: "This plan is assigned to another subscriber" } };
        }
        return {
            ok: true,
            value: {
                id: plan.id,
                merchantAddress: plan.merchantAddress,
                name: plan.name,
                amountUsdc: BigInt(plan.amountUsdc),
                periodSeconds: BigInt(plan.periodSeconds),
                checkoutSessionId: plan.sourceCheckoutId ?? null,
                planId: plan.id,
            },
        };
    }

    const checkout = await prisma.paymentLink.findUnique({ where: { id } });
    const meta = readSubscriptionCheckoutMeta(checkout?.stateSnapshot);
    if (!checkout || !meta || !checkout.active || !["PENDING", "PROCESSING"].includes(checkout.status)) {
        return { ok: false, status: 404, body: { error: "Plan not found or inactive" } };
    }
    if (meta.subscriber && meta.subscriber !== subscriber) {
        return {
            ok: false,
            status: 403,
            body: { error: "This subscription checkout is assigned to another subscriber" },
        };
    }
    if (isCheckoutExpired(checkout)) {
        return {
            ok: false,
            status: 410,
            body: {
                error: "This subscription offer has expired. Ask the merchant for a new checkout link.",
                code: "CHECKOUT_EXPIRED",
                expiresAt: checkoutExpiresAt(checkout).toISOString(),
            },
        };
    }

    /* A checkout published as a catalog plan should still record that plan on the new mirror row, so
       the upgraded subscription stays attributable to the same plan the merchant manages. */
    const linkedPlan = await prisma.merchantPlan.findUnique({
        where: { sourceCheckoutId: checkout.id },
        select: { id: true },
    }).catch(() => null);

    return {
        ok: true,
        value: {
            id: checkout.id,
            merchantAddress: checkout.merchantAddress,
            name: checkout.title,
            amountUsdc: BigInt(checkout.amountUsdc),
            periodSeconds: subscriptionCheckoutPeriod(meta),
            checkoutSessionId: checkout.id,
            planId: linkedPlan?.id ?? null,
        },
    };
}

/**
 * Everything both verbs need, resolved from the caller's session and the target id alone.
 *
 * The subscription being replaced is DERIVED, never accepted from the request. An id supplied by the
 * client would let a caller aim the cancellation at a row they do not own.
 */
async function resolveUpgrade(
    subscriber: string,
    id: string,
): Promise<{ ok: true; value: ResolvedUpgrade } | Refusal> {
    if (!id) {
        return { ok: false, status: 400, body: { error: "planId is required" } };
    }

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
            status: { in: ["ACTIVE", "PAST_DUE"] },
        },
        orderBy: { createdAt: "desc" },
    });
    if (!current) {
        return {
            ok: false,
            status: 409,
            body: {
                error: "You don't have an active subscription with this merchant to upgrade. Subscribe to this plan instead.",
                code: "NO_ACTIVE_SUBSCRIPTION",
            },
        };
    }

    const fromSubscriptionId = String(current.subscriptionId);
    const onChain = await getSubscriptionOnChain(fromSubscriptionId);
    if (!onChain) {
        return {
            ok: false,
            status: 503,
            body: {
                error: "We couldn't read your current subscription on-chain. Try again in a moment.",
                code: "CHAIN_READ_FAILED",
            },
        };
    }
    if (onChain.subscriber !== subscriber || onChain.merchant !== merchant) {
        return { ok: false, status: 404, body: { error: "Subscription not found for this account" } };
    }
    if (!onChain.isActive) {
        /* The authorization is already revoked — most likely a cancellation whose paid period is still
           running. Upgrading from here would price credit against an authorization that can no longer
           be cancelled, so send them through resume first. */
        return {
            ok: false,
            status: 409,
            body: {
                error: "This subscription is canceled on-chain. Resume it first, then upgrade.",
                code: "RESUME_BEFORE_UPGRADE",
                subscriptionId: fromSubscriptionId,
            },
        };
    }

    const newAmountMicros = target.amountUsdc;
    const newPeriodSeconds = target.periodSeconds;
    const terms = upgradeCheckoutTerms({
        /* Old terms come from the CHAIN: after a resume the mirror deliberately holds the plan cadence
           while the chain holds the shorter bridge period, and the credit owed is a function of what
           was actually paid for. */
        oldAmountMicros: onChain.amount,
        oldPeriodSeconds: onChain.period,
        paidThroughAt: new Date(Number(onChain.nextPayment) * 1000),
        newAmountMicros,
        newPeriodSeconds,
        now: new Date(),
    });

    if (!terms.ok) {
        if (terms.code === "NOT_AN_UPGRADE") {
            return {
                ok: false,
                status: 403,
                body: {
                    error: "Plan reductions aren't available. Pick a plan with a higher recurring rate.",
                    code: "NOT_AN_UPGRADE",
                },
            };
        }
        if (terms.code === "CREDIT_EXCEEDS_NEW_PLAN") {
            const from = terms.upgradeableAt?.toISOString().slice(0, 10);
            return {
                ok: false,
                status: 409,
                body: {
                    error: `You have ${formatUsdcFromMicros(terms.unusedCreditMicros)} USDC of unused time, which is worth more than this plan costs. Upgrade from ${from} and none of it goes to waste.`,
                    code: "CREDIT_EXCEEDS_NEW_PLAN",
                    unusedCreditUsdc: formatUsdcFromMicros(terms.unusedCreditMicros),
                    upgradeableAt: terms.upgradeableAt?.toISOString() ?? null,
                },
            };
        }
        return {
            ok: false,
            status: 400,
            body: { error: "This plan's billing terms can't be upgraded to.", code: terms.code },
        };
    }

    return {
        ok: true,
        value: {
            merchant,
            target,
            current,
            fromSubscriptionId,
            onChain,
            newAmountMicros,
            newPeriodSeconds,
            terms,
        },
    };
}

/** Session wallet with the USER role, or the response to send instead. */
async function requireSubscriber(request: Request): Promise<{ ok: true; subscriber: string } | Refusal> {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) return { ok: false, status: 401, body: { error: "Unauthorized" } };
    const roleCheck = await requireAccountRole(wallet, "USER");
    if (!roleCheck.ok) return { ok: false, status: roleCheck.status, body: { error: roleCheck.error } };
    return { ok: true, subscriber: wallet.toLowerCase() };
}

/* GET /api/user/subscription/upgrade?planId=...
 *
 * Read-only preview for the checkout page. Returns `upgrade: false` rather than an error when the
 * caller has no subscription to upgrade, so the page can fall through to an ordinary subscribe. */
export async function GET(request: Request) {
    try {
        const auth = await requireSubscriber(request);
        if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

        const planId = new URL(request.url).searchParams.get("planId")?.trim() || "";
        const resolved = await resolveUpgrade(auth.subscriber, planId);

        if (!resolved.ok) {
            /* "You have nothing to upgrade" is the normal state for most visitors, not a failure. */
            if (resolved.body.code === "NO_ACTIVE_SUBSCRIPTION") {
                return NextResponse.json({ success: true, upgrade: false }, { status: 200 });
            }
            return NextResponse.json({ success: true, upgrade: false, ...resolved.body }, { status: 200 });
        }

        const { terms, current, onChain, target } = resolved.value;
        return NextResponse.json({
            success: true,
            upgrade: true,
            planName: target.name,
            fromSubscriptionId: resolved.value.fromSubscriptionId,
            currentAmountUsdc: formatUsdcFromMicros(microsFromDecimal(current.amountCapUsdc)),
            newAmountUsdc: formatUsdcFromMicros(resolved.value.newAmountMicros),
            creditAppliedUsdc: formatUsdcFromMicros(terms.unusedCreditMicros),
            chargedNowUsdc: formatUsdcFromMicros(terms.dueTodayMicros),
            nextChargeAt: terms.firstRegularChargeAt.toISOString(),
            paidThroughAt: new Date(Number(onChain.nextPayment) * 1000).toISOString(),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Upgrade preview failed:", error);
        return NextResponse.json({ error: error.message || "Failed to price this upgrade" }, { status: 500 });
    }
}

/* amount_cap_usdc is a numeric column holding integer micro-USDC. Truncating rather than trusting
   Decimal formatting keeps a stray ".0" from throwing inside BigInt. */
function microsFromDecimal(value: unknown): bigint {
    return BigInt(String(value).split(".")[0] || "0");
}

export async function POST(request: Request) {
    try {
        const auth = await requireSubscriber(request);
        if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
        const subscriber = auth.subscriber;

        /* An upgrade re-authorizes the subscription at a new price and usually charges a proration
           straight away, so it is a new authorization against the caller's own wallet. Gated in POST
           rather than in requireSubscriber, because GET is a read-only preview for the checkout page
           and a held account still gets to see what an upgrade would cost. */
        const held = await haltGuard(subscriber);
        if (held) return held;

        try {
            assertFinancialNetworkReady();
        } catch (networkError) {
            console.error("[subscription/upgrade] financial network is not ready:", networkError);
            return NextResponse.json({ error: "Subscriptions are temporarily unavailable." }, { status: 503 });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId.trim() : "";

        const resolved = await resolveUpgrade(subscriber, planId);
        if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });

        const {
            merchant, target, current, fromSubscriptionId, onChain, newAmountMicros, newPeriodSeconds, terms,
        } = resolved.value;

        /* Serialize against the subscribe/resume paths on the SAME key, so a fast double-submit or a
           concurrent subscribe cannot both pass their duplicate checks before either has mirrored. */
        const lockKey = `customer-subscription:${subscriber}:${merchant}`;
        const idempotencyKey = `upgrade:${current.contractAddress}:${fromSubscriptionId}:${target.id}`;
        /* The provider key is the same seed in the UUID shape Circle requires — it rejects anything
           else with a bare `400 API parameter invalid`. Kept separate from `idempotencyKey` so the
           attempt row stays human-readable while the persisted `providerIdempotencyKey` is exactly
           what Circle was sent, which is what reconciliation matches on. Sending the raw seed here
           failed AFTER the old authorization had already been revoked. */
        const providerIdempotencyKey = deterministicIdempotencyKey(idempotencyKey);
        const requestFingerprint = crypto
            .createHash("sha256")
            .update(`${idempotencyKey}:${newAmountMicros}:${newPeriodSeconds}`)
            .digest("hex");

        const claim = await prisma.$transaction(async (tx) => {
            const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
                SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
            `;
            if (!(lockRows?.[0]?.acquired ?? false)) return { status: "CONCURRENT" as const };

            const existingAttempt = await tx.subscriptionAttempt.findUnique({
                where: { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } },
            });
            if (existingAttempt) return { status: "ATTEMPT_EXISTS" as const };

            await tx.subscriptionAttempt.create({
                data: {
                    merchantAddress: merchant,
                    subscriberAddress: subscriber,
                    idempotencyKey,
                    requestFingerprint,
                    providerIdempotencyKey,
                    status: "PREPARED",
                },
            });
            return { status: "NEW" as const };
        }).catch((error: unknown) => {
            console.error("[subscription/upgrade] claim transaction failed:", error);
            return { status: "CONCURRENT" as const };
        });

        if (claim.status === "CONCURRENT") {
            return NextResponse.json({
                error: "Another change to this subscription is in progress. Try again shortly.",
                code: "CONCURRENT_REQUEST",
            }, { status: 409 });
        }
        if (claim.status === "ATTEMPT_EXISTS") {
            return NextResponse.json({
                error: "This upgrade has already been submitted. Refresh to see its current state.",
                code: "UPGRADE_IN_PROGRESS",
            }, { status: 409 });
        }

        /* Shares the `subscribe` budget: an upgrade mints an authorization exactly as a subscribe does,
           so it belongs in the same per-action daily bucket. */
        await requireSponsoredGas({ wallet: subscriber, action: "subscribe", requestKey: idempotencyKey });

        /* 1. Revoke the old authorization. Nothing has moved yet, so a failure here is a clean retry. */
        const revocationTxHash = await cancelFromEmbedded(subscriber, fromSubscriptionId);

        /* 2. Mint the new authorization, charging only what is due today. */
        let txHash: string;
        let newSubscriptionId: string | null;
        try {
            const created = await subscribeFromEmbedded(
                subscriber,
                merchant,
                newAmountMicros,
                newPeriodSeconds,
                providerIdempotencyKey,
                /* The credit is expressed as the sequence-0 charge. With no credit dueToday EQUALS the
                   new amount, and the contract rejects `_introductoryAmount >= _amount` — so that case
                   goes through the plain create, which charges the same figure. */
                terms.useIntroductoryTerms
                    ? { introAmountUsdc: terms.dueTodayMicros, introCycles: 1 }
                    : null,
            );
            txHash = created.txHash;
            newSubscriptionId = created.subId;
        } catch (createError) {
            /* The old authorization is revoked and the new one did not land. The subscriber has paid
               nothing extra and still owns their paid period, so record the row the way `resume` expects
               to find it — canceled with paid time left — and point them at it. Leaving the mirror
               claiming ACTIVE against a revoked chain state is the one outcome that strands them: the
               keeper reads it as cancelled on-chain and can never bill it. */
            await mirrorSubscriptionCancelAtPeriodEnd({
                subscriptionId: fromSubscriptionId,
                merchantAddress: merchant,
                subscriber,
                amountUsdc: onChain.amount,
                periodSeconds: onChain.period,
                nextPaymentSeconds: onChain.nextPayment,
                revocationTxHash,
                revocationPending: false,
            }).catch((mirrorError) =>
                console.error("[subscription/upgrade] recovery mirror failed:", mirrorError),
            );
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-upgrade-create:${fromSubscriptionId}:${target.id}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "upgrade revoked the old authorization but the new one could not be created",
                context: { fromSubscriptionId, planId: target.id, merchant, subscriber },
                error: createError,
            }).catch(() => {});
            const accessUntil = new Date(Number(onChain.nextPayment) * 1000);
            return NextResponse.json({
                error: `The upgrade didn't complete and you were not charged. Your ${formatUsdcFromMicros(onChain.amount)} USDC plan is still active until ${accessUntil.toISOString().slice(0, 10)} — resume it from your dashboard, then try again.`,
                code: "UPGRADE_CREATE_FAILED",
                accessUntil: accessUntil.toISOString(),
            }, { status: 502 });
        }

        if (!newSubscriptionId) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-upgrade-id:${fromSubscriptionId}:${txHash.toLowerCase()}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "upgrade authorization confirmed on-chain but its subscription id could not be recovered",
                context: { fromSubscriptionId, planId: target.id, merchant, subscriber, txHash: txHash.toLowerCase() },
            }).catch(() => {});
            return NextResponse.json({
                error: "Your upgrade is on-chain but still reconciling. Refresh in a moment — do not submit it again.",
                code: "RECONCILIATION_PENDING",
                txHash,
            }, { status: 202 });
        }

        /* 3. Record the new authorization BEFORE closing the old row. It is the one that can move money,
              so it must never exist on-chain without a mirror row the keeper can bill. Unlike a resume
              bridge, the on-chain period and the mirror cadence match here, so this subscription stays
              upgradeable afterwards. */
        const commitmentRemainingSeconds = current.minCommitmentUntil
            ? Math.max(0, Math.floor((current.minCommitmentUntil.getTime() - Date.now()) / 1000))
            : 0;
        await mirrorSubscriptionCreated({
            subscriptionId: newSubscriptionId,
            merchantAddress: merchant,
            subscriber,
            amountUsdc: newAmountMicros,
            periodSeconds: newPeriodSeconds,
            beneficiaryAddress: current.beneficiaryAddress,
            /* Preserved rather than restarted: upgrading must not newly lock in a subscriber whose
               original commitment window was already partly served. */
            minCommitmentSeconds: BigInt(commitmentRemainingSeconds),
            /* Credit for time already paid for is not an introductory offer. Recording it as one would
               make pricingPhaseFor report the subscriber as mid-promotion and quote the wrong next
               charge. */
            promotion: null,
            anchorNextPaymentSeconds: BigInt(Math.floor(terms.firstRegularChargeAt.getTime() / 1000)),
            externalReference: current.externalReference,
            sourceCheckoutId: target.checkoutSessionId ?? current.sourceCheckoutId,
            planId: target.planId ?? current.planId,
        });

        /* 4. Close the old run. Two rows claiming ACTIVE for one (subscriber, merchant) would have the
              keeper charge a revoked authorization, fail, and eventually report a payment failure that
              never happened. */
        try {
            await prisma.subscription.update({
                where: subscriptionKey(current.subscriptionId, current.contractAddress),
                data: { status: "CANCELED", revocationPending: false, revocationTxHash, updatedAt: new Date() },
            });
        } catch (closeError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-upgrade-close:${fromSubscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "upgrade mirrored the new authorization but could not close the superseded row",
                context: { fromSubscriptionId, newSubscriptionId, merchant, subscriber },
                error: closeError,
            }).catch(() => {});
        }

        await prisma.subscriptionAttempt.update({
            where: { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } },
            data: { status: "PAID", txHash, completedAt: new Date() },
        }).catch(() => {});

        await emitUpgradeSignals({
            merchant,
            subscriber,
            subscriptionId: newSubscriptionId,
            previousSubscriptionId: fromSubscriptionId,
            planName: target.name,
            amountUsdc: newAmountMicros,
            periodSeconds: newPeriodSeconds,
            chargedMicros: terms.dueTodayMicros,
            creditMicros: terms.unusedCreditMicros,
            nextBillingDate: terms.firstRegularChargeAt,
            externalReference: current.externalReference,
            sourceCheckoutId: current.sourceCheckoutId,
            beneficiaryAddress: current.beneficiaryAddress,
            txHash,
        });

        return NextResponse.json({
            success: true,
            upgraded: true,
            subscriptionId: newSubscriptionId,
            previousSubscriptionId: fromSubscriptionId,
            planName: target.name,
            /* Stated explicitly: the credit applied and what actually left the wallet. */
            creditAppliedUsdc: formatUsdcFromMicros(terms.unusedCreditMicros),
            chargedNowUsdc: formatUsdcFromMicros(terms.dueTodayMicros),
            nextChargeAt: terms.firstRegularChargeAt.toISOString(),
            txHash,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Upgrade subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to upgrade subscription" }, { status: 500 });
    }
}

/**
 * The customer's DM and the merchant's webhook for an upgrade.
 *
 * Best-effort by contract: the authorization and its mirror row are already durable by the time this
 * runs, so a notification outage must not turn a completed upgrade into an ambiguous 500.
 */
async function emitUpgradeSignals(params: {
    merchant: string;
    subscriber: string;
    subscriptionId: string;
    previousSubscriptionId: string;
    planName: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    chargedMicros: bigint;
    creditMicros: bigint;
    nextBillingDate: Date;
    externalReference: string | null;
    sourceCheckoutId: string | null;
    beneficiaryAddress: string | null;
    txHash: string;
}) {
    await createSubscriptionStartedDm({
        merchantAddress: params.merchant,
        subscriberAddress: params.subscriber,
        planName: params.planName,
        amountUsdc: params.amountUsdc,
        periodSeconds: params.periodSeconds,
        isChange: true,
        changeTerms: {
            effective: "immediate",
            proratedChargeUsdc: params.chargedMicros,
            creditAppliedUsdc: params.creditMicros,
            nextBillingDate: params.nextBillingDate,
        },
    }).catch((err) => console.error("[subscription/upgrade] DM failed:", err));

    try {
        await dispatchDurableSubscriptionWebhook(params.merchant, "subscription.updated", {
            ...subscriptionWebhookData({
                subscriptionId: params.subscriptionId,
                status: "active",
                amountUsdcMicros: params.amountUsdc,
                subscriber: params.subscriber,
                merchantAddress: params.merchant,
                txHash: params.txHash,
                beneficiary: params.beneficiaryAddress,
                externalReference: params.externalReference,
                sourceCheckoutId: params.sourceCheckoutId,
                reason: "Upgraded by subscriber at checkout; unused time credited",
            }),
            /* Upgrade-specific fields, in the dual snake_case + camelCase form the other builders emit.
               The id changes because an upgrade mints a new authorization, which is why merchants are
               told to key entitlements on merchantCustomerId. */
            previous_subscription_id: `sub_${params.previousSubscriptionId}`,
            previousSubscriptionId: `sub_${params.previousSubscriptionId}`,
            effective: "immediate",
            prorated_charge_usdc_micros: params.chargedMicros.toString(),
            proratedChargeUsdcMicros: params.chargedMicros.toString(),
            credit_applied_usdc_micros: params.creditMicros.toString(),
            creditAppliedUsdcMicros: params.creditMicros.toString(),
            current_period_end: params.nextBillingDate.toISOString(),
            currentPeriodEnd: params.nextBillingDate.toISOString(),
        }, `customer-upgraded:${params.subscriptionId}`);
    } catch (webhookError) {
        console.error("[ALERT] upgrade webhook enqueue failed after state committed:", webhookError);
    }
}
