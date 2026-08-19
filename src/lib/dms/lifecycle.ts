/**
 * Subscription-lifecycle DMs: the merchant→customer messages for moments that had no message.
 *
 * Every helper here shares one shape — resolve the merchant's display name, build a body that
 * states the numbers plainly, and write with an occurrence-scoped dedupe key so a cron pass
 * cannot re-send it. That last part is the reason this module exists rather than more inline
 * `createDmAndNotify` calls: the reminder cron wrote its DM with no dedupe key at all, so the
 * customer's "reminder" cadence was whatever the cron schedule happened to be.
 *
 * Rules:
 * - Block comments only.
 * - Every writer goes through sendLifecycleDm, which asserts the dedupe discipline.
 * - Copy states the amount, the date, and what the customer can do. A notice the customer
 *   cannot act on is noise, and an allowance warning that reads like a card decline sends them
 *   to fix the wrong thing.
 * - Best-effort by contract: these are notifications, never the durable record of a billing
 *   decision. A push or insert failure must not fail the surrounding billing operation.
 */

import { prisma } from "@/lib/prisma";
import { createDmAndNotify } from "@/lib/dms/notifications";
import {
    assertDedupeDiscipline,
    billingCycleDiscriminator,
    subscriptionDmDedupeKey,
    type DmType,
} from "@/lib/dms/catalog";
import { formatUsdcFromMicros } from "@/lib/dms/system";

/* ----------------------------- Shared helpers ------------------------------ */

/** Human-readable billing cadence from a period in seconds. */
function formatPeriodLabel(periodSeconds: bigint | number | string): string {
    const seconds = Number(periodSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return "cycle";
    const days = Math.round(seconds / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
}

/** Calendar date, no time-of-day. Billing dates are read, not scheduled against, by customers. */
function formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

/**
 * Merchant display name, falling back to a truncated address.
 *
 * Resolved per call rather than passed in. These helpers are invoked from crons iterating
 * subscriptions where the caller has the address but not the alias, and a DM headed
 * `0x1a2b...9f0e` is materially worse than one naming the business.
 */
async function resolveMerchantName(merchantAddress: string): Promise<string> {
    const merchant = merchantAddress.toLowerCase();
    const alias = await prisma.addressAlias
        .findUnique({ where: { address: merchant } })
        .catch(() => null);
    return alias?.alias || `${merchant.slice(0, 6)}...${merchant.slice(-4)}`;
}

type LifecycleDmInput = {
    messageType: DmType;
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    /** Stable within one occurrence, different across occurrences. See subscriptionDmDedupeKey. */
    occurrence: string;
    title: string;
    lines: Array<string | null | undefined>;
    amountUsdc?: bigint | null;
};

export type LifecycleDmResult = { sent: boolean; deduped: boolean };

/**
 * The single write path for lifecycle DMs.
 *
 * Returns `deduped: true` when the row already existed, which callers use to decide whether to
 * also emit a webhook — re-emitting an event for a notice that was suppressed would make the
 * merchant's event stream disagree with the customer's inbox.
 */
async function sendLifecycleDm(input: LifecycleDmInput): Promise<LifecycleDmResult> {
    const dedupeKey = subscriptionDmDedupeKey(
        input.messageType,
        input.subscriptionId,
        input.occurrence,
    );
    assertDedupeDiscipline(input.messageType, dedupeKey);

    const merchant = input.merchantAddress.toLowerCase();
    const subscriber = input.subscriberAddress.toLowerCase();

    /* A subscription with no recorded subscriber has nobody to notify. This is a real state:
       the mirror can hold a row whose subscriber column was never populated, and the previous
       reminder cron passed `sub.subscriber || ""` straight through, writing DM rows addressed
       to the empty string that no inbox would ever query. */
    if (!subscriber || subscriber === merchant) {
        return { sent: false, deduped: false };
    }

    const existing = await prisma.subscriptDm
        .findUnique({ where: { dedupeKey }, select: { id: true } })
        .catch(() => null);
    if (existing) return { sent: false, deduped: true };

    const description = input.lines.filter(Boolean).join("\n");

    try {
        await createDmAndNotify({
            senderAddress: merchant,
            receiverAddress: subscriber,
            messageType: input.messageType,
            status: "APPROVED",
            amountUsdc: input.amountUsdc ?? null,
            title: input.title,
            description,
            dedupeKey,
        });
        return { sent: true, deduped: false };
    } catch (error: any) {
        /* P2002 on the dedupe key means a concurrent pass won the race. That is the mechanism
           working, not a failure — two keeper instances scanning the same cycle is expected. */
        if (error?.code === "P2002") return { sent: false, deduped: true };
        throw error;
    }
}

/* ----------------------------- Renewal reminder ---------------------------- */

/**
 * Advance notice that a renewal will be charged.
 *
 * The gap this closes: `cron/payment-reminders` scanned only `status: PAST_DUE`, so every
 * reminder in the product fired *after* a charge had already failed. A customer with a funding
 * problem learned about it from a service interruption.
 */
export async function sendRenewalUpcomingDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    amountUsdcMicros: bigint;
    periodSeconds: bigint;
    renewsAt: Date;
    leadHours: number;
    /* True when introductory cycles have ended and this is the first charge at full price —
       the single most important thing to say, and the moment a surprise charge would otherwise
       land. */
    isFirstRegularCharge?: boolean;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);
    const amount = formatUsdcFromMicros(params.amountUsdcMicros);
    const cadence = formatPeriodLabel(params.periodSeconds);

    return sendLifecycleDm({
        messageType: "RENEWAL_UPCOMING",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: billingCycleDiscriminator(params.renewsAt),
        amountUsdc: params.amountUsdcMicros,
        title: params.isFirstRegularCharge
            ? `${amount} USDC renewal on ${formatDate(params.renewsAt)} — introductory price ends`
            : `${amount} USDC renewal on ${formatDate(params.renewsAt)}`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            `Amount: ${amount} USDC`,
            `Renews: ${formatDate(params.renewsAt)}`,
            params.isFirstRegularCharge
                ? `This is your first charge at the regular ${amount} USDC / ${cadence} price. Your introductory period has ended.`
                : `This renews every ${cadence}.`,
            "No action needed if you want to continue. Cancel from your dashboard before this date to avoid the charge.",
        ],
    });
}

/* ----------------------------- Allowance warning --------------------------- */

/**
 * Warn that the spending authorization — not the balance — is running out.
 *
 * Worth being explicit about why this is its own message. A SubScript subscription is two
 * grants: the permanent on-chain authorization, and a finite ERC-20 allowance the keeper spends
 * against, approved for roughly a year of cycles at signup and never renewed. When it runs dry
 * the renewal fails with "insufficient USDC balance or allowance" — so a customer with a full
 * wallet is told to add funds that will not help. This message names the real cause.
 */
export async function sendAllowanceLowDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    amountUsdcMicros: bigint;
    allowanceUsdcMicros: bigint;
    cyclesRemaining: number;
    /* The cycle this warning belongs to, so a subscriber is warned once per cycle rather than
       on every keeper pass while the runway stays low. */
    nextBillingDate: Date;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);
    const amount = formatUsdcFromMicros(params.amountUsdcMicros);
    const cycles = params.cyclesRemaining;

    return sendLifecycleDm({
        messageType: "ALLOWANCE_LOW",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: billingCycleDiscriminator(params.nextBillingDate),
        amountUsdc: params.amountUsdcMicros,
        title: cycles <= 0
            ? "Subscription authorization has run out"
            : `Subscription authorization covers ${cycles} more renewal${cycles === 1 ? "" : "s"}`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            cycles <= 0
                ? `The spending authorization for this ${amount} USDC subscription has run out.`
                : `The spending authorization for this ${amount} USDC subscription covers ${cycles} more renewal${cycles === 1 ? "" : "s"}.`,
            "This is not your balance. It's the approval you signed when you subscribed, which covers about a year of renewals and then needs renewing.",
            "Adding USDC will not extend it — re-authorize from your dashboard to keep renewals running.",
        ],
    });
}

/* ----------------------------- Trial ending -------------------------------- */

/**
 * Notice that an introductory phase is ending and the regular price starts.
 *
 * Distinct from RENEWAL_UPCOMING because the customer's decision is different: the question is
 * not "can I fund this renewal" but "do I want this at the real price". Sent early enough to
 * cancel without being charged.
 */
export async function sendTrialEndingDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    regularAmountUsdcMicros: bigint;
    introAmountUsdcMicros: bigint;
    periodSeconds: bigint;
    firstRegularPaymentAt: Date;
    leadHours: number;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);
    const regular = formatUsdcFromMicros(params.regularAmountUsdcMicros);
    const intro = formatUsdcFromMicros(params.introAmountUsdcMicros);
    const cadence = formatPeriodLabel(params.periodSeconds);
    const isFreeTrial = params.introAmountUsdcMicros === BigInt(0);

    return sendLifecycleDm({
        messageType: "TRIAL_ENDING",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: billingCycleDiscriminator(params.firstRegularPaymentAt),
        amountUsdc: params.regularAmountUsdcMicros,
        title: isFreeTrial
            ? `Free trial ends ${formatDate(params.firstRegularPaymentAt)}`
            : `Introductory price ends ${formatDate(params.firstRegularPaymentAt)}`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            isFreeTrial
                ? "You are currently on a free trial."
                : `You are currently paying ${intro} USDC per ${cadence}.`,
            `From ${formatDate(params.firstRegularPaymentAt)} this becomes ${regular} USDC / ${cadence}.`,
            "Keep it and no action is needed. Cancel from your dashboard before that date if you don't want the charge.",
        ],
    });
}

/* ----------------------------- Win-back offer ------------------------------ */

/**
 * A retention offer, presented to a subscriber who is leaving.
 *
 * Keyed on the subscription being cancelled rather than on a cycle: one offer per cancellation,
 * not one per pass. A second offer for the same cancellation reads as pressure, not service.
 */
export async function sendWinbackOfferDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    promotionName: string;
    offerAmountUsdcMicros: bigint;
    regularAmountUsdcMicros: bigint;
    offerCycles: number;
    periodSeconds: bigint;
    accessUntil?: Date | null;
    expiresAt?: Date | null;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);
    const offer = formatUsdcFromMicros(params.offerAmountUsdcMicros);
    const regular = formatUsdcFromMicros(params.regularAmountUsdcMicros);
    const cadence = formatPeriodLabel(params.periodSeconds);
    const isFree = params.offerAmountUsdcMicros === BigInt(0);

    return sendLifecycleDm({
        messageType: "WINBACK_OFFER",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: "cancellation",
        amountUsdc: params.offerAmountUsdcMicros,
        title: isFree
            ? `${merchantName}: ${params.offerCycles} free ${params.offerCycles === 1 ? cadence : `${cadence}s`} if you come back`
            : `${merchantName}: ${offer} USDC / ${cadence} if you come back`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            `Offer: ${params.promotionName}`,
            isFree
                ? `${params.offerCycles} free ${params.offerCycles === 1 ? cadence : `${cadence}s`}, then ${regular} USDC / ${cadence}.`
                : `${offer} USDC / ${cadence} for ${params.offerCycles} ${params.offerCycles === 1 ? "cycle" : "cycles"}, then ${regular} USDC / ${cadence}.`,
            params.accessUntil
                ? `Your current access runs until ${formatDate(params.accessUntil)} — your cancellation still stands.`
                : "Your cancellation still stands.",
            params.expiresAt ? `This offer expires ${formatDate(params.expiresAt)}.` : null,
            "Resubscribe from your dashboard to take it.",
        ],
    });
}

/* ----------------------------- Reactivation -------------------------------- */

/** Confirmation that a previously-churned subscription is billing again. */
export async function sendReactivatedDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    amountUsdcMicros: bigint;
    periodSeconds: bigint;
    nextBillingDate: Date;
    churnKind: "voluntary" | "involuntary";
    promotionApplied?: { name: string; amountUsdcMicros: bigint; cycles: number } | null;
    /**
     * True when the subscriber resumed inside a period they had already paid for, so the
     * reactivation moved no funds.
     *
     * Worth its own line rather than leaving it implied. Every other reactivation in the product
     * charges on the spot, so a subscriber reading this DM has every reason to assume they were
     * billed again — which is precisely the fear that made the old resume flow feel broken.
     */
    nothingChargedToday?: boolean;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);
    const amount = formatUsdcFromMicros(params.amountUsdcMicros);
    const cadence = formatPeriodLabel(params.periodSeconds);

    return sendLifecycleDm({
        messageType: "SUBSCRIPTION_REACTIVATED",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: "reactivation",
        amountUsdc: params.amountUsdcMicros,
        title: `Subscription to ${params.planName || merchantName} reactivated`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            params.promotionApplied
                ? `Paid today: ${formatUsdcFromMicros(params.promotionApplied.amountUsdcMicros)} USDC (${params.promotionApplied.name})`
                : `Amount: ${amount} USDC / ${cadence}`,
            params.promotionApplied
                ? `Then: ${amount} USDC / ${cadence}`
                : null,
            params.nothingChargedToday
                ? "Charged today: nothing — you had already paid for this period."
                : null,
            `Next billing date: ${formatDate(params.nextBillingDate)}`,
            params.churnKind === "involuntary"
                ? "Your previous subscription ended after a payment couldn't be collected. This one is active again."
                : "Welcome back.",
            "You can manage or cancel this subscription anytime from your dashboard.",
        ],
    });
}

/* ----------------------------- Commitment ---------------------------------- */

/**
 * State a minimum-term commitment back to a subscriber who tried to cancel inside it.
 *
 * Written to the thread rather than left as an HTTP error, so the term and its end date are in
 * a durable place the customer can re-read. A commitment enforced only through a transient
 * error message is one the customer has no record of agreeing to.
 */
export async function sendCommitmentActiveDm(params: {
    merchantAddress: string;
    subscriberAddress: string;
    subscriptionId: bigint | number | string;
    planName?: string | null;
    amountUsdcMicros: bigint;
    commitmentUntil: Date;
}): Promise<LifecycleDmResult> {
    const merchantName = await resolveMerchantName(params.merchantAddress);

    return sendLifecycleDm({
        messageType: "COMMITMENT_ACTIVE",
        merchantAddress: params.merchantAddress,
        subscriberAddress: params.subscriberAddress,
        subscriptionId: params.subscriptionId,
        occurrence: billingCycleDiscriminator(params.commitmentUntil),
        amountUsdc: params.amountUsdcMicros,
        title: `Minimum term runs to ${formatDate(params.commitmentUntil)}`,
        lines: [
            `Merchant: ${merchantName}`,
            params.planName ? `Plan: ${params.planName}` : null,
            `This plan carried a minimum term when you subscribed, ending ${formatDate(params.commitmentUntil)}.`,
            "Your cancellation is scheduled for the end of that term — you won't be billed beyond it, and access continues until then.",
        ],
    });
}
