/**
 * Subscription reminder sweep.
 *
 * Two scans, one pass:
 *
 * 1. UPCOMING — ACTIVE customer subscriptions whose next charge falls inside the lead window.
 *    This is the scan that did not exist. The cron previously matched only `status: PAST_DUE`,
 *    which means every reminder the product has ever sent fired *after* a charge already
 *    failed. A customer with a funding problem found out from a service interruption.
 *
 * 2. OVERDUE — PAST_DUE subscriptions, the original behaviour, with three defects fixed:
 *    - No dedupe key, so the same overdue notice was rewritten on every pass. The reminder
 *      cadence was whatever the cron schedule happened to be.
 *    - `receiverAddress: sub.subscriber || ""` wrote rows addressed to the empty string when
 *      the mirror had no subscriber recorded. No inbox queries for "", so those were silent
 *      writes that looked like sends.
 *    - No `kind` filter, so PREMIUM rows — merchant→SubScript platform billing — were treated
 *      as customer subscriptions and the merchant received DMs addressed to them as if they
 *      were their own customer.
 *
 * Also emits the matching merchant webhooks, so an integrated platform can act on the same
 * signal (pause provisioning, prompt for funds) instead of only the customer seeing it.
 *
 * Rules:
 * - Block comments only.
 * - Notification failures never fail the run. A DM is not the durable record of anything here.
 * - Every DM carries a cycle-scoped dedupe key. See subscriptionDmDedupeKey.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { subscriptionDmDedupeKey, billingCycleDiscriminator } from "@/lib/dms/catalog";
import {
    sendRenewalUpcomingDm,
    sendSponsoredAccessEndingDm,
    sendTrialEndingDm,
    type LifecycleDmResult,
} from "@/lib/dms/lifecycle";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import { formatUsdcFromMicros } from "@/lib/dms/system";

/**
 * How far ahead of a renewal the customer is told.
 *
 * 72 hours is the shortest window that is still actionable for a custodial funding path: it
 * spans a weekend, which a 24-hour notice does not. Plans whose whole period is shorter than
 * the window are excluded below rather than warned continuously.
 */
const RENEWAL_LEAD_HOURS = 72;

/**
 * Lead time for the introductory-price-ending notice, longer than the renewal window.
 *
 * A customer deciding whether to keep a service at its real price is making a different
 * decision from one funding a renewal they already want, and deserves more than three days.
 */
const TRIAL_LEAD_HOURS = 7 * 24;

/**
 * Lead time before a gifted access window closes.
 *
 * Matched to the trial notice rather than the renewal one: the beneficiary of a gift is making the
 * same decision a trialist is — whether to start paying for this themselves — and has no funding
 * to arrange, so three days would be needlessly tight.
 */
const SPONSORED_LEAD_HOURS = 7 * 24;

/** Bound on rows touched per pass, so one sweep cannot run long enough to be killed mid-write. */
const SCAN_LIMIT = 200;

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));

    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

type SubscriptionRow = {
    subscriptionId: bigint;
    merchantAddress: string;
    subscriber: string | null;
    amountCapUsdc: unknown;
    billingIntervalSeconds: bigint;
    nextBillingDate: Date;
    status: string;
    cancelAtPeriodEnd: boolean;
    externalReference: string | null;
    introAmountUsdc: bigint | null;
    introCycles: number | null;
    firstRegularPaymentAt: Date | null;
    promotionId: string | null;
};

const SUBSCRIPTION_SELECT = {
    subscriptionId: true,
    merchantAddress: true,
    subscriber: true,
    amountCapUsdc: true,
    billingIntervalSeconds: true,
    nextBillingDate: true,
    status: true,
    cancelAtPeriodEnd: true,
    externalReference: true,
    introAmountUsdc: true,
    introCycles: true,
    firstRegularPaymentAt: true,
    promotionId: true,
} as const;

/**
 * amount_cap_usdc is a Decimal column holding micro-USDC. Number() then BigInt() would lose
 * precision above 2^53 micro-USDC; going through the string keeps it exact.
 */
function amountMicros(value: unknown): bigint {
    try {
        return BigInt(String(value ?? "0").split(".")[0] || "0");
    } catch {
        return BigInt(0);
    }
}

/** Plan name for the DM body, resolved per merchant+amount. Absent is fine — copy omits it. */
async function resolvePlanName(merchantAddress: string, amount: bigint): Promise<string | null> {
    const plan = await prisma.merchantPlan
        .findFirst({
            where: { merchantAddress: merchantAddress.toLowerCase(), amountUsdc: amount },
            select: { name: true },
            orderBy: { createdAt: "desc" },
        })
        .catch(() => null);
    return plan?.name ?? null;
}

/**
 * True when this renewal is the first at the regular price after introductory cycles.
 *
 * Worth calling out in the reminder: it is the one renewal whose amount differs from what the
 * customer has been paying, and the classic surprise-charge complaint.
 */
function isFirstRegularCharge(sub: SubscriptionRow): boolean {
    if (!sub.firstRegularPaymentAt) return false;
    const bill = sub.nextBillingDate.getTime();
    const firstRegular = sub.firstRegularPaymentAt.getTime();
    /* Within an hour of the recorded boundary — the keeper may have shifted the stored date
       slightly during a drift heal, and an exact equality check would miss it. */
    return Math.abs(bill - firstRegular) < 60 * 60 * 1000;
}

/**
 * Emit the merchant-facing event for a reminder that was actually sent.
 *
 * Gated on the DM not being deduped so the merchant's event stream and the customer's inbox
 * agree — re-emitting for a suppressed notice would show the integrator a reminder the
 * customer never received.
 */
async function emitReminderEvent(params: {
    eventType: "subscription.renewal_upcoming" | "subscription.trial_ending";
    sub: SubscriptionRow;
    amount: bigint;
    occurrence: string;
    extra: Record<string, unknown>;
}) {
    const { sub, amount, occurrence, eventType, extra } = params;
    await recordMerchantEvent({
        merchantAddress: sub.merchantAddress,
        environment: "LIVE",
        eventType,
        resourceType: "subscription",
        resourceId: sub.subscriptionId.toString(),
        resourceVersion: 1,
        /* The cycle discriminator makes the event ID idempotent per cycle, matching the DM's
           dedupe key — a re-run of the sweep re-derives the same ID and the insert no-ops. */
        transitionKey: `${eventType}:${sub.subscriptionId}:${occurrence}`,
        correlationId: `reminder-sweep:${sub.subscriptionId}:${occurrence}`,
        data: {
            subscription_id: sub.subscriptionId.toString(),
            status: "active",
            amount_usdc_micros: amount.toString(),
            currency: "USDC",
            subscriber: sub.subscriber,
            merchant_address: sub.merchantAddress,
            merchant_customer_id: null,
            external_reference: sub.externalReference,
            ...extra,
        },
    });
}

export async function POST(request: Request) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();
        const renewalHorizon = new Date(now.getTime() + RENEWAL_LEAD_HOURS * 60 * 60 * 1000);
        const trialHorizon = new Date(now.getTime() + TRIAL_LEAD_HOURS * 60 * 60 * 1000);

        const counts = {
            upcomingScanned: 0,
            upcomingSent: 0,
            trialEndingSent: 0,
            overdueScanned: 0,
            overdueSent: 0,
            sponsoredScanned: 0,
            sponsoredSent: 0,
            skippedNoSubscriber: 0,
            deduped: 0,
            errors: 0,
        };

        /* ---------------- Scan 1: renewals inside the lead window ---------------- */

        const upcoming = (await prisma.subscription.findMany({
            where: {
                status: "ACTIVE",
                /* CUSTOMER only. PREMIUM rows are the merchant's own platform subscription to
                   SubScript, billed by cron/billing; reminding a merchant about those through
                   the customer DM path addressed them as their own customer. */
                kind: "CUSTOMER",
                /* Already-cancelled-at-period-end subscriptions will not renew, so a renewal
                   reminder would contradict the cancellation the customer just requested. */
                cancelAtPeriodEnd: false,
                nextBillingDate: { gt: now, lte: renewalHorizon },
                subscriber: { not: null },
            },
            select: SUBSCRIPTION_SELECT,
            take: SCAN_LIMIT,
        })) as SubscriptionRow[];

        counts.upcomingScanned = upcoming.length;

        for (const sub of upcoming) {
            try {
                if (!sub.subscriber) {
                    counts.skippedNoSubscriber += 1;
                    continue;
                }

                /* Skip plans whose entire period fits inside the lead window. A daily or hourly
                   plan is always within 72h of its next charge, so it would be "reminded"
                   every cycle forever — which is a subscription to reminders, not a warning. */
                const periodHours = Number(sub.billingIntervalSeconds) / 3600;
                if (!Number.isFinite(periodHours) || periodHours <= RENEWAL_LEAD_HOURS) continue;

                const amount = amountMicros(sub.amountCapUsdc);
                const planName = await resolvePlanName(sub.merchantAddress, amount);
                const firstRegular = isFirstRegularCharge(sub);
                const occurrence = billingCycleDiscriminator(sub.nextBillingDate);

                /* An introductory phase ending gets the trial notice instead of the renewal
                   notice — same charge, but the customer's decision is about price, not
                   funding, and sending both would say the same thing twice. */
                let result: LifecycleDmResult;
                if (firstRegular && sub.introAmountUsdc !== null && sub.firstRegularPaymentAt) {
                    result = await sendTrialEndingDm({
                        merchantAddress: sub.merchantAddress,
                        subscriberAddress: sub.subscriber,
                        subscriptionId: sub.subscriptionId,
                        planName,
                        regularAmountUsdcMicros: amount,
                        introAmountUsdcMicros: sub.introAmountUsdc,
                        periodSeconds: sub.billingIntervalSeconds,
                        firstRegularPaymentAt: sub.firstRegularPaymentAt,
                        leadHours: RENEWAL_LEAD_HOURS,
                    });
                    if (result.sent) {
                        counts.trialEndingSent += 1;
                        await emitReminderEvent({
                            eventType: "subscription.trial_ending",
                            sub,
                            amount,
                            occurrence,
                            extra: {
                                trial_amount_usdc_micros: sub.introAmountUsdc.toString(),
                                promotion_id: sub.promotionId,
                                first_regular_payment_at: sub.firstRegularPaymentAt.toISOString(),
                                lead_hours: RENEWAL_LEAD_HOURS,
                            },
                        }).catch((err) =>
                            console.error(`[cron/payment-reminders] trial_ending event failed for sub_${sub.subscriptionId}:`, err),
                        );
                    }
                } else {
                    result = await sendRenewalUpcomingDm({
                        merchantAddress: sub.merchantAddress,
                        subscriberAddress: sub.subscriber,
                        subscriptionId: sub.subscriptionId,
                        planName,
                        amountUsdcMicros: amount,
                        periodSeconds: sub.billingIntervalSeconds,
                        renewsAt: sub.nextBillingDate,
                        leadHours: RENEWAL_LEAD_HOURS,
                        isFirstRegularCharge: firstRegular,
                    });
                    if (result.sent) {
                        counts.upcomingSent += 1;
                        await emitReminderEvent({
                            eventType: "subscription.renewal_upcoming",
                            sub,
                            amount,
                            occurrence,
                            extra: {
                                renews_at: sub.nextBillingDate.toISOString(),
                                lead_hours: RENEWAL_LEAD_HOURS,
                                is_first_regular_charge: firstRegular,
                            },
                        }).catch((err) =>
                            console.error(`[cron/payment-reminders] renewal_upcoming event failed for sub_${sub.subscriptionId}:`, err),
                        );
                    }
                }

                if (result.deduped) counts.deduped += 1;
            } catch (err) {
                counts.errors += 1;
                console.error(`[cron/payment-reminders] upcoming reminder failed for sub_${sub.subscriptionId}:`, err);
            }
        }

        /* ---------------- Scan 2: introductory phases ending further out -------- */

        /* Separate from scan 1 because the lead time is longer. A subscription whose intro
           period ends in five days is outside the 72h renewal window but inside this one. */
        const trialEnding = (await prisma.subscription.findMany({
            where: {
                status: "ACTIVE",
                kind: "CUSTOMER",
                cancelAtPeriodEnd: false,
                subscriber: { not: null },
                introAmountUsdc: { not: null },
                firstRegularPaymentAt: { gt: renewalHorizon, lte: trialHorizon },
            },
            select: SUBSCRIPTION_SELECT,
            take: SCAN_LIMIT,
        })) as SubscriptionRow[];

        for (const sub of trialEnding) {
            try {
                if (!sub.subscriber || !sub.firstRegularPaymentAt || sub.introAmountUsdc === null) continue;
                const amount = amountMicros(sub.amountCapUsdc);
                const planName = await resolvePlanName(sub.merchantAddress, amount);
                const result = await sendTrialEndingDm({
                    merchantAddress: sub.merchantAddress,
                    subscriberAddress: sub.subscriber,
                    subscriptionId: sub.subscriptionId,
                    planName,
                    regularAmountUsdcMicros: amount,
                    introAmountUsdcMicros: sub.introAmountUsdc,
                    periodSeconds: sub.billingIntervalSeconds,
                    firstRegularPaymentAt: sub.firstRegularPaymentAt,
                    leadHours: TRIAL_LEAD_HOURS,
                });
                if (result.sent) {
                    counts.trialEndingSent += 1;
                    await emitReminderEvent({
                        eventType: "subscription.trial_ending",
                        sub,
                        amount,
                        occurrence: billingCycleDiscriminator(sub.firstRegularPaymentAt),
                        extra: {
                            trial_amount_usdc_micros: sub.introAmountUsdc.toString(),
                            promotion_id: sub.promotionId,
                            first_regular_payment_at: sub.firstRegularPaymentAt.toISOString(),
                            lead_hours: TRIAL_LEAD_HOURS,
                        },
                    }).catch((err) =>
                        console.error(`[cron/payment-reminders] trial_ending event failed for sub_${sub.subscriptionId}:`, err),
                    );
                }
                if (result.deduped) counts.deduped += 1;
            } catch (err) {
                counts.errors += 1;
                console.error(`[cron/payment-reminders] trial-ending reminder failed for sub_${sub.subscriptionId}:`, err);
            }
        }

        /* ---------------- Scan 3: overdue (the original behaviour) --------------- */

        const pastDueSubs = (await prisma.subscription.findMany({
            where: {
                status: "PAST_DUE",
                kind: "CUSTOMER",
                nextBillingDate: { lt: now },
                subscriber: { not: null },
            },
            select: SUBSCRIPTION_SELECT,
            take: SCAN_LIMIT,
        })) as SubscriptionRow[];

        counts.overdueScanned = pastDueSubs.length;

        for (const sub of pastDueSubs) {
            try {
                /* Guarded rather than coerced. The previous `sub.subscriber || ""` wrote a DM
                   addressed to the empty string, which every inbox query misses — a silent
                   write that counted as a send. */
                if (!sub.subscriber) {
                    counts.skippedNoSubscriber += 1;
                    continue;
                }

                const amount = amountMicros(sub.amountCapUsdc);
                const amountUsdc = formatUsdcFromMicros(amount);

                /* Cycle-scoped, so the customer is reminded once per missed cycle rather than
                   once per cron pass. Without this the notice repeated at the cron's cadence. */
                const dedupeKey = subscriptionDmDedupeKey(
                    "PAYMENT_REMINDER",
                    sub.subscriptionId,
                    billingCycleDiscriminator(sub.nextBillingDate),
                );

                const existing = await prisma.subscriptDm
                    .findUnique({ where: { dedupeKey }, select: { id: true } })
                    .catch(() => null);
                if (existing) {
                    counts.deduped += 1;
                    continue;
                }

                await createDmAndNotify({
                    senderAddress: sub.merchantAddress,
                    receiverAddress: sub.subscriber,
                    messageType: "PAYMENT_REMINDER",
                    status: "APPROVED",
                    amountUsdc: amount,
                    title: `Payment of ${amountUsdc} USDC is overdue`,
                    /* Was "Net 30 Payment Overdue Reminder". SubScript subscriptions are prepaid
                       USDC authorizations — there are no invoice terms to be net-30 against, and
                       the phrase told the customer to look for a bill that does not exist. */
                    description: [
                        `Subscription: sub_${sub.subscriptionId}`,
                        `Amount: ${amountUsdc} USDC`,
                        `Due: ${sub.nextBillingDate.toISOString().slice(0, 10)}`,
                        "The last renewal attempt didn't go through. Top up your USDC balance to restore access.",
                        "If your balance is already funded, your spending authorization may have run out — re-authorize from your dashboard.",
                    ].join("\n"),
                    dedupeKey,
                });
                counts.overdueSent += 1;
            } catch (err) {
                counts.errors += 1;
                console.error(`[cron/payment-reminders] Error sending reminder for sub_${sub.subscriptionId}:`, err);
            }
        }

        /* ------------ Scan 3: sponsored (gifted) access windows closing ------------
         *
         * Gifts are not subscriptions. A sponsored checkout is a one-time `payment_links` row with
         * `maxUses: 1` and a beneficiary distinct from the payer — no authorization, no
         * `subscriptions` row — so neither scan above and no billing cron can see it, and the
         * beneficiary's access used to just stop.
         *
         * The window is derivable from what already exists: the settling payment's `created_at` plus
         * the link's `state_snapshot.durationSeconds`. No new table, and the same value the merchant
         * received as `access_until` on the payment.succeeded webhook. */
        const sponsoredLeadMs = SPONSORED_LEAD_HOURS * 60 * 60 * 1000;
        const sponsoredPayments = await prisma.paymentLinkPayment.findMany({
            where: {
                beneficiaryAddress: { not: null },
                /* Only ever a window that could still be open: nothing older than the longest plan
                   period we would notice, bounded so the scan does not walk all history. */
                createdAt: { gte: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000) },
                paymentLink: { stateSnapshot: { path: ["isSponsored"], equals: true } },
            },
            select: {
                id: true,
                createdAt: true,
                amountUsdc: true,
                merchantAddress: true,
                beneficiaryAddress: true,
                payerAddress: true,
                paymentLink: { select: { stateSnapshot: true } },
            },
            orderBy: { createdAt: "desc" },
            take: SCAN_LIMIT,
        }).catch((err) => {
            console.error("[cron/payment-reminders] sponsored scan failed:", err);
            return [] as Array<never>;
        });

        for (const payment of sponsoredPayments) {
            counts.sponsoredScanned += 1;
            try {
                const snapshot = (payment.paymentLink?.stateSnapshot ?? null) as Record<string, unknown> | null;
                const durationSeconds = typeof snapshot?.durationSeconds === "number"
                    && Number.isFinite(snapshot.durationSeconds)
                    ? snapshot.durationSeconds
                    : null;
                if (!durationSeconds || durationSeconds <= 0 || !payment.beneficiaryAddress) continue;

                const accessUntil = new Date(payment.createdAt.getTime() + durationSeconds * 1000);
                /* Inside the lead window and not already past. A window that closed before we ever
                   looked gets no retroactive notice — telling someone their access ended last month
                   is noise, not service. */
                if (accessUntil <= now) continue;
                if (accessUntil.getTime() - now.getTime() > sponsoredLeadMs) continue;

                const result = await sendSponsoredAccessEndingDm({
                    merchantAddress: payment.merchantAddress,
                    beneficiaryAddress: payment.beneficiaryAddress,
                    sponsorshipId: payment.id,
                    planName: typeof snapshot?.sponsoredPlanName === "string" ? snapshot.sponsoredPlanName : null,
                    amountUsdcMicros: payment.amountUsdc,
                    accessUntil,
                });
                if (result.sent) counts.sponsoredSent += 1;
                if (result.deduped) counts.deduped += 1;
            } catch (err) {
                counts.errors += 1;
                console.error(`[cron/payment-reminders] sponsored notice failed for payment ${payment.id}:`, err);
            }
        }

        return NextResponse.json({
            success: true,
            leadHours: {
                renewal: RENEWAL_LEAD_HOURS,
                trial: TRIAL_LEAD_HOURS,
                sponsored: SPONSORED_LEAD_HOURS,
            },
            ...counts,
        });
    } catch (error: any) {
        console.error("Payment reminders cron error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
