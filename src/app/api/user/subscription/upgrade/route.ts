import { assertAuthorizedFinancialRecord, assertAuthorizedSubscriptionUpgrade, authorizedFinancialSnapshot } from "@/lib/auth/financialAuthorizationContext";
import { financialPinContext } from "@/lib/auth/financialPinPolicy";
import { withTransactionPin, TransactionPinError, type TransactionPinBindingContext } from "@/lib/auth/transactionPin";
import type { VerifiedSessionToken } from "@/lib/auth";
import { subscriptionUpgradeSnapshot } from "@/lib/auth/subscriptionUpgradeAuthorization";
/* Upgrade a subscription to a higher-rate plan, settled from the hosted subscription checkout.
 *
 * One atomic `replaceSubscription` (PSA v3): the old authorization is cancelled and the new one
 * created in the same transaction. The old route did cancel-then-create as two transactions, and a
 * crash between them left the subscriber with no authorization while the database still said ACTIVE.
 * An in-place `modifySubscription` is still not an option, because it refuses any period change.
 *
 * The subscriber pays the new plan's price minus credit for unused paid time, taken as the new
 * authorization's sequence-0 charge. The credit is priced on value actually paid for the current
 * window, never on the list price. See lib/subscriptions/upgradeCheckout and planChange.
 *
 * GET previews the terms for the checkout page. The money math is computed server-side in both verbs
 * from the same resolver, so the figure the subscriber is shown is the figure that gets charged.
 *
 * Custodial wallets are server-signed (gas covered by SubScript). External wallets get the exact call
 * to sign, then post the hash, which is verified against the quoted terms.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
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
import { creditBasisForRow } from "@/lib/subscriptions/planChange";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { onActiveContract, subscriptionKey } from "@/lib/subscriptions/contractBinding";
import { resolveUpgradeTarget, type UpgradeTarget, type Refusal } from "@/lib/subscriptions/planTarget";
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

type ResolvedUpgrade = {
    merchant: string;
    target: UpgradeTarget;
    current: NonNullable<Awaited<ReturnType<typeof prisma.subscription.findFirst>>>;
    fromSubscriptionId: string;
    onChain: NonNullable<Awaited<ReturnType<typeof getSubscriptionOnChain>>>;
    newAmountMicros: bigint;
    newPeriodSeconds: bigint;
    paidThroughAt: Date;
    terms: UpgradeCheckoutTerms;
};


/**
 * Everything both verbs need, resolved from the caller's session and the target id alone.
 *
 * The subscription being replaced is DERIVED, never accepted from the request. An id supplied by the
 * client would let a caller aim the cancellation at a row they do not own.
 */
async function resolveUpgrade(
    subscriber: string,
    id: string,
    quotedAt = new Date(),
    allowRevoked = false,
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
    if (!onChain.isActive && !allowRevoked) {
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
    const paidThroughSeconds = await getSubscriptionPaidThrough(fromSubscriptionId, onChain);
    const paidThroughAt = new Date(Number(paidThroughSeconds) * 1000);
    /* Credit is priced on what was actually paid for the current window: the cash the chain charged
       for this sequence plus any value carried in from a replaced authorization. Pricing it on the
       list amount credited trial and intro-price subscribers for time they never paid for. */
    const creditBasis = await creditBasisForRow(fromSubscriptionId, onChain, paidThroughSeconds, current);
    const terms = upgradeCheckoutTerms({
        /* Old terms come from the CHAIN: after a resume the mirror deliberately holds the plan cadence
           while the chain holds the shorter bridge period, and the credit owed is a function of what
           was actually paid for. */
        oldAmountMicros: onChain.amount,
        oldPeriodSeconds: onChain.period,
        paidThroughAt,
        newAmountMicros,
        newPeriodSeconds,
        now: quotedAt,
        creditBasis,
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
            paidThroughAt,
            terms,
        },
    };
}

async function bindUpgradeAuthorization(body: any, session: VerifiedSessionToken, request: Request, context: TransactionPinBindingContext) {
    // A refreshed challenge must not resurrect an old credit quote indefinitely.
    if (Date.now() - context.quotedAt.getTime() > 10 * 60 * 1000) {
        throw new TransactionPinError(409, "TRANSACTION_AUTHORITY_CHANGED", "The upgrade quote expired. Start a new operation.");
    }
    const base = await financialPinContext(body, session, request);
    const resolved = await resolveUpgrade(session.wallet.toLowerCase(), typeof body?.planId === "string" ? body.planId.trim() : "", context.quotedAt, true);
    return { ...base, upgrade: resolved.ok ? subscriptionUpgradeSnapshot(resolved.value, context.quotedAt) : null };
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

        const { terms, current, paidThroughAt, target } = resolved.value;
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
            paidThroughAt: paidThroughAt.toISOString(),
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

async function handlePOST(request: Request) {
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

        const approved = authorizedFinancialSnapshot<{ upgrade: { quotedAt: string } | null }>();
        const quotedAt = approved?.upgrade ? new Date(approved.upgrade.quotedAt) : new Date();
        const resolved = await resolveUpgrade(subscriber, planId, quotedAt);
        if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });

        assertAuthorizedSubscriptionUpgrade(subscriptionUpgradeSnapshot(resolved.value, quotedAt));

        const {
            merchant, target, current, fromSubscriptionId, onChain, newAmountMicros, newPeriodSeconds, paidThroughAt, terms,
        } = resolved.value;

        /* The atomic replace needs PSA v3. Refuse before anything is claimed or signed, so an old
           deployment can never fall back to the cancel-then-create path that could strand a
           subscriber with no authorization. */
        if (!await supportsReplaceSubscriptions()) {
            return NextResponse.json({
                error: "Plan upgrades need the updated subscription contract, which isn't live yet. Your current plan is unchanged.",
                code: "CONTRACT_UPGRADE_REQUIRED",
            }, { status: 503 });
        }

        const replaceTerms: ReplaceTerms = {
            newAmount: newAmountMicros,
            newPeriod: newPeriodSeconds,
            /* Charged now as the new authorization's sequence 0. With no credit it equals the new
               amount, which the contract requires to go through without introductory terms. */
            chargeNow: terms.dueTodayMicros,
            firstPaymentAt: BigInt(0),
            introCycles: terms.useIntroductoryTerms ? BigInt(1) : BigInt(0),
        };

        /* External wallets sign the same replace themselves. The first call returns exactly what to
           sign, and the second carries the hash, which is verified against these quoted terms. */
        const custodial = isCustodialWallet(await getWalletCustody(subscriber));
        const externalTxHash = typeof body.txHash === "string" ? body.txHash : null;
        if (!custodial && !externalTxHash) {
            return NextResponse.json({
                requiresWalletSignature: true,
                contractAddress: STANDARD_CONTRACT_ADDRESS,
                functionName: "replaceSubscription",
                args: replaceSubscriptionArgs(fromSubscriptionId, replaceTerms).map(String),
                allowanceUsdcMicros: horizonAllowance(newAmountMicros, newPeriodSeconds).toString(),
                chargedNowUsdc: formatUsdcFromMicros(terms.dueTodayMicros),
                error: "Confirm the plan change in your connected wallet.",
            }, { status: 409 });
        }
        if (!custodial && !/^0x[0-9a-fA-F]{64}$/.test(externalTxHash || "")) {
            return NextResponse.json({ error: "A valid confirmed plan-change transaction hash is required." }, { status: 400 });
        }

        /* Serialize against the subscribe/resume paths on the SAME key, so a fast double-submit or a
           concurrent subscribe cannot both pass their duplicate checks before either has mirrored. */
        const lockKey = `customer-subscription:${subscriber}:${merchant}`;
        const idempotencyKey = `upgrade:${current.contractAddress}:${fromSubscriptionId}:${target.id}`;
        /* The provider key is the same seed in the UUID shape Circle requires. It rejects anything
           else with a bare `400 API parameter invalid`. */
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
            if (existingAttempt) {
                /* A replace that provably never landed (the old authorization was still active
                   afterwards) is retryable. Anything else is in flight or done. */
                if (existingAttempt.status !== "FAILED") return { status: "ATTEMPT_EXISTS" as const };
                await tx.subscriptionAttempt.update({
                    where: { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } },
                    data: { status: "PREPARED", requestFingerprint },
                });
                return { status: "NEW" as const };
            }

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
        const markAttempt = (status: string, txHashValue?: string | null) => prisma.subscriptionAttempt.update({
            where: { merchantAddress_idempotencyKey: { merchantAddress: merchant, idempotencyKey } },
            data: {
                status,
                ...(txHashValue ? { txHash: txHashValue } : {}),
                ...(status === "PAID" ? { completedAt: new Date() } : {}),
            },
        }).catch(() => {});

        /* One transaction: the old authorization is cancelled and the new one created atomically, so
           the subscriber can never be left holding neither (the old cancel-then-create gap) or both. */
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
                    error: verifyError instanceof Error ? verifyError.message : "We couldn't verify that plan change.",
                    code: "EXTERNAL_REPLACE_UNVERIFIED",
                }, { status: 400 });
            }
        } else {
            /* Shares the `subscribe` budget: an upgrade mints an authorization exactly as a subscribe
               does, so it belongs in the same per-action daily bucket. */
            await requireSponsoredGas({ wallet: subscriber, action: "subscribe", requestKey: idempotencyKey });
            try {
                ({ txHash, subId: newSubscriptionId } = await replaceFromEmbedded(
                    subscriber, fromSubscriptionId, replaceTerms, providerIdempotencyKey,
                ));
            } catch (replaceError) {
                /* The replace is atomic, so the chain answers what happened. Old authorization still
                   active: nothing moved, and the upgrade can simply be retried. Anything else means
                   it landed (or the read failed), so recover rather than invite a second attempt. */
                const after = await getSubscriptionOnChain(fromSubscriptionId);
                if (after?.isActive) {
                    await markAttempt("FAILED");
                    return NextResponse.json({
                        error: "The upgrade didn't go through and you weren't charged. Your current plan is unchanged, so you can try again.",
                        code: "UPGRADE_FAILED",
                    }, { status: 502 });
                }
                console.error("[subscription/upgrade] replace returned an error but may have landed:", replaceError);
                txHash = null;
                newSubscriptionId = after
                    ? await findActiveOnChainSubscriptionIdOrNull(subscriber, merchant).catch(() => null)
                    : null;
            }
        }

        if (!newSubscriptionId) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-upgrade-id:${fromSubscriptionId}:${target.id}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "upgrade replace may have landed on-chain but the new subscription id could not be recovered",
                context: { fromSubscriptionId, planId: target.id, merchant, subscriber, txHash: txHash?.toLowerCase() ?? null },
            }).catch(() => {});
            await markAttempt("RECONCILIATION_REQUIRED", txHash);
            return NextResponse.json({
                error: "Your upgrade is on-chain but still reconciling. Refresh in a moment and don't submit it again.",
                code: "RECONCILIATION_PENDING",
                txHash,
            }, { status: 202 });
        }

        /* Record the new authorization BEFORE closing the old row. It is the one that can move money,
           so it must never exist on-chain without a mirror row the keeper can bill. Its next charge is
           read from the chain rather than the quote, which can be up to 10 minutes older. */
        const createdOnChain = await getSubscriptionOnChain(newSubscriptionId);
        const nextChargeAt = createdOnChain
            ? new Date(Number(createdOnChain.nextPayment) * 1000)
            : terms.firstRegularChargeAt;
        const commitmentRemainingSeconds = current.minCommitmentUntil
            ? Math.max(0, Math.floor((current.minCommitmentUntil.getTime() - Date.now()) / 1000))
            : 0;
        try {
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
                /* Credit for time already paid for is not an introductory offer. Recording it as one
                   would make pricingPhaseFor report the subscriber as mid-promotion. */
                promotion: null,
                anchorNextPaymentSeconds: BigInt(Math.floor(nextChargeAt.getTime() / 1000)),
                externalReference: current.externalReference,
                sourceCheckoutId: target.checkoutSessionId ?? current.sourceCheckoutId,
                planId: target.planId ?? current.planId,
                /* The credit is part of what this first window is worth. A later upgrade prices its
                   own credit on cash plus this, so the subscriber is not shorted. */
                carriedCredit: { micros: terms.unusedCreditMicros, since: new Date() },
            });
        } catch (mirrorError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-upgrade-mirror:${fromSubscriptionId}:${newSubscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "upgrade replaced the authorization on-chain but the new mirror row could not be written",
                context: { fromSubscriptionId, newSubscriptionId, planId: target.id, merchant, subscriber, txHash },
                error: mirrorError,
            }).catch(() => {});
            await markAttempt("RECONCILIATION_REQUIRED", txHash);
            return NextResponse.json({
                error: "Your upgrade went through but is still being recorded. Refresh in a moment and don't submit it again.",
                code: "RECONCILIATION_PENDING",
                subscriptionId: newSubscriptionId,
                txHash,
            }, { status: 202 });
        }

        /* Close the old run. Two rows claiming ACTIVE for one (subscriber, merchant) would have the
           keeper charge a replaced authorization, fail, and report a payment failure that never
           happened. */
        try {
            await prisma.subscription.update({
                where: subscriptionKey(current.subscriptionId, current.contractAddress),
                data: { status: "CANCELED", revocationPending: false, revocationTxHash: txHash, updatedAt: new Date() },
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

        await markAttempt("PAID", txHash);

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
            nextBillingDate: nextChargeAt,
            externalReference: current.externalReference,
            /* The checkout this subscription now belongs to, matching the new mirror row. */
            sourceCheckoutId: target.checkoutSessionId ?? current.sourceCheckoutId,
            beneficiaryAddress: current.beneficiaryAddress,
            planId: target.planId ?? current.planId,
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
            nextChargeAt: nextChargeAt.toISOString(),
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
    planId: string | null;
    txHash: string | null;
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
                txHash: params.txHash ?? undefined,
                beneficiary: params.beneficiaryAddress,
                externalReference: params.externalReference,
                sourceCheckoutId: params.sourceCheckoutId,
                reason: "Upgraded by subscriber at checkout; unused time credited",
            }),
            /* Upgrade-specific fields, in the dual snake_case + camelCase form the other builders emit.
               The id changes because an upgrade mints a new authorization, which is why merchants are
               told to key entitlements on merchantCustomerId. */
            plan_id: params.planId,
            planId: params.planId,
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

export const POST = withTransactionPin({ action: "subscription-upgrade", bind: bindUpgradeAuthorization }, handlePOST);
