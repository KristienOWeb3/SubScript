/* Introductory-pricing promotions attached to merchant plans.
 *
 * Model: one regular plan + one editable promotional offer + an immutable per-subscription
 * snapshot. The merchant may edit or deactivate the offer at any time; that only changes
 * what FUTURE subscribers are offered. Terms a customer already authorized live in the
 * subscription snapshot and on-chain (createSubscriptionWithIntroductoryTerms) and can
 * never be altered from here.
 *
 * "40% off" means the customer PAYS 60%: introductory = regular * (10000 - bps) / 10000,
 * computed in exact integer micro-USDC (floor).
 */
import { prisma } from "@/lib/prisma";

export const DISCOUNT_TYPES = ["PERCENT", "FIXED_PRICE", "FREE_TRIAL"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/* Mirrors the on-chain MAX_INTRODUCTORY_CYCLES ceiling. */
export const MAX_INTRODUCTORY_CYCLES = 36;

export type PromotionRow = {
    id: string;
    merchantAddress: string;
    planId: string;
    name: string;
    discountType: string;
    discountBps: number | null;
    regularAmountUsdc: bigint;
    introductoryAmountUsdc: bigint;
    introductoryCycles: number;
    startsAt: Date | null;
    expiresAt: Date | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    newCustomersOnly: boolean;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
};

/* Exact integer micro-USDC introductory amount for a discount configuration.
   Throws when the configuration is not a genuine discount. */
export function computeIntroductoryAmount(args: {
    discountType: DiscountType;
    regularAmountUsdc: bigint;
    discountBps?: number | null;
    fixedIntroAmountUsdc?: bigint | null;
}): { introductoryAmountUsdc: bigint; discountBps: number | null } {
    const regular = args.regularAmountUsdc;
    if (regular <= BigInt(0)) throw new Error("Plan price must be greater than 0");

    if (args.discountType === "FREE_TRIAL") {
        return { introductoryAmountUsdc: BigInt(0), discountBps: null };
    }
    if (args.discountType === "PERCENT") {
        const bps = Number(args.discountBps);
        if (!Number.isInteger(bps) || bps < 1 || bps > 10000) {
            throw new Error("Discount must be between 0.01% and 100%");
        }
        const intro = (regular * BigInt(10000 - bps)) / BigInt(10000);
        return { introductoryAmountUsdc: intro, discountBps: bps };
    }
    if (args.discountType === "FIXED_PRICE") {
        const intro = args.fixedIntroAmountUsdc;
        if (intro === null || intro === undefined || intro < BigInt(0)) {
            throw new Error("Introductory price is required");
        }
        if (intro >= regular) {
            throw new Error("Introductory price must be lower than the regular plan price");
        }
        return { introductoryAmountUsdc: intro, discountBps: null };
    }
    throw new Error("Unknown discount type");
}

/* Is the offer live right now (independent of per-customer eligibility)? */
export function isPromotionLive(promo: PromotionRow, now: Date = new Date()): boolean {
    if (!promo.active) return false;
    if (promo.startsAt && promo.startsAt > now) return false;
    if (promo.expiresAt && promo.expiresAt <= now) return false;
    if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) return false;
    return true;
}

/* The live promotion a given subscriber may redeem on a plan, or null. Checks the offer
   window/cap, once-per-customer, and (when the offer demands it) that the subscriber has
   never had a subscription with this merchant. Advisory only — claimPromotionRedemption
   re-checks the cap atomically. */
export async function findApplicablePromotion(args: {
    planId: string;
    merchantAddress: string;
    subscriber?: string | null;
}): Promise<PromotionRow | null> {
    const promo = await prisma.merchantPlanPromotion.findFirst({
        where: { planId: args.planId, active: true },
    });
    if (!promo || !isPromotionLive(promo as PromotionRow)) return null;

    const subscriber = args.subscriber?.toLowerCase();
    if (subscriber) {
        const redeemed = await prisma.promotionRedemption.findUnique({
            where: {
                promotionId_subscriberAddress: {
                    promotionId: promo.id,
                    subscriberAddress: subscriber,
                },
            },
        });
        if (redeemed) return null;

        if (promo.newCustomersOnly) {
            const prior = await prisma.subscription.count({
                where: {
                    subscriber,
                    merchantAddress: args.merchantAddress.toLowerCase(),
                    kind: "CUSTOMER",
                },
            });
            if (prior > 0) return null;
        }
    }
    return promo as PromotionRow;
}

/* Atomic redemption claim (SQL function locks the promotion row, enforces the cap and
   once-per-customer, and counts the redemption). Claim BEFORE broadcasting the on-chain
   create; release if the create never happened; confirm with the subId once it did. */
export async function claimPromotionRedemption(promotionId: string, subscriber: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ claimed: boolean }[]>`
        SELECT public.claim_promotion_redemption(${promotionId}::uuid, ${subscriber.toLowerCase()}) AS claimed
    `;
    return rows?.[0]?.claimed === true;
}

export async function releasePromotionRedemption(promotionId: string, subscriber: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ released: boolean }[]>`
        SELECT public.release_promotion_redemption(${promotionId}::uuid, ${subscriber.toLowerCase()}) AS released
    `;
    return rows?.[0]?.released === true;
}

export async function confirmPromotionRedemption(promotionId: string, subscriber: string, subscriptionId: bigint): Promise<void> {
    await prisma.$executeRaw`
        SELECT public.confirm_promotion_redemption(${promotionId}::uuid, ${subscriber.toLowerCase()}, ${subscriptionId})
    `;
}

/* Serialization shared by the merchant API and the customer-facing plan listing. */
export function formatPromotion(p: PromotionRow) {
    return {
        id: p.id,
        planId: p.planId,
        name: p.name,
        discountType: p.discountType,
        discountBps: p.discountBps,
        regularAmountUsdc: p.regularAmountUsdc.toString(),
        introductoryAmountUsdc: p.introductoryAmountUsdc.toString(),
        introductoryCycles: p.introductoryCycles,
        startsAt: p.startsAt ? p.startsAt.toISOString() : null,
        expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
        maxRedemptions: p.maxRedemptions,
        redemptionCount: p.redemptionCount,
        newCustomersOnly: p.newCustomersOnly,
        active: p.active,
    };
}

/* Pricing block for merchant webhooks/receipts: which phase a given billing sequence is
   in and what it charges, derived from the immutable subscription snapshot. */
export function pricingPhaseFor(args: {
    sequenceId: number;
    regularAmountUsdc: bigint;
    introAmountUsdc?: bigint | null;
    introCycles?: number | null;
}): {
    phase: "introductory" | "regular";
    chargedAmountUsdcMicros: bigint;
    introductoryCyclesRemaining: number;
    nextPaymentAmountUsdcMicros: bigint;
} {
    const cycles = args.introCycles ?? 0;
    const intro = args.introAmountUsdc ?? BigInt(0);
    const inIntro = cycles > 0 && args.sequenceId < cycles;
    const remainingAfter = inIntro ? Math.max(cycles - args.sequenceId - 1, 0) : 0;
    return {
        phase: inIntro ? "introductory" : "regular",
        chargedAmountUsdcMicros: inIntro ? intro : args.regularAmountUsdc,
        introductoryCyclesRemaining: remainingAfter,
        nextPaymentAmountUsdcMicros: remainingAfter > 0 ? intro : args.regularAmountUsdc,
    };
}
