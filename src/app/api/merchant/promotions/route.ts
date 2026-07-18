/* Merchant-managed introductory promotions on plans: "40% off the first month",
   "9 USDC for 3 cycles", "first month free". Fully editable by the merchant — edits and
   deactivation only affect FUTURE subscribers; terms a customer already authorized are
   snapshotted on their subscription and enforced on-chain, so they can never change. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { parseUsdcToMicros } from "@/lib/dms/system";
import {
    computeIntroductoryAmount,
    formatPromotion,
    DISCOUNT_TYPES,
    MAX_INTRODUCTORY_CYCLES,
    type DiscountType,
} from "@/lib/subscriptions/promotions";

const MAX_NAME_LEN = 60;

function parseOptionalDate(raw: unknown, field: string): { ok: true; value: Date | null } | { ok: false; error: string } {
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
    if (typeof raw !== "string") return { ok: false, error: `${field} must be an ISO date string` };
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: `${field} is not a valid date` };
    return { ok: true, value: parsed };
}

/* Shared validation for POST (create) and PATCH (re-pricing): turns the request body into
   the pricing snapshot columns, computed against the plan's immutable regular price. */
function buildPricingTerms(body: any, regularAmountUsdc: bigint):
    | { ok: true; discountType: DiscountType; discountBps: number | null; introductoryAmountUsdc: bigint; introductoryCycles: number }
    | { ok: false; error: string } {
    const discountType = typeof body.discountType === "string" ? body.discountType.toUpperCase() : "";
    if (!DISCOUNT_TYPES.includes(discountType as DiscountType)) {
        return { ok: false, error: "discountType must be PERCENT, FIXED_PRICE, or FREE_TRIAL" };
    }

    let cyclesRaw = body.introductoryCycles ?? 1;
    const introductoryCycles = Number(cyclesRaw);
    if (!Number.isInteger(introductoryCycles) || introductoryCycles < 1 || introductoryCycles > MAX_INTRODUCTORY_CYCLES) {
        return { ok: false, error: `introductoryCycles must be an integer between 1 and ${MAX_INTRODUCTORY_CYCLES}` };
    }

    try {
        if (discountType === "PERCENT") {
            /* Merchants think in whole percent ("40% off"); accept decimals up to bps precision. */
            const percentOff = Number(body.percentOff);
            if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
                return { ok: false, error: "percentOff must be between 1 and 100" };
            }
            const bps = Math.round(percentOff * 100);
            const { introductoryAmountUsdc, discountBps } = computeIntroductoryAmount({
                discountType: "PERCENT",
                regularAmountUsdc,
                discountBps: bps,
            });
            return { ok: true, discountType: "PERCENT", discountBps, introductoryAmountUsdc, introductoryCycles };
        }
        if (discountType === "FIXED_PRICE") {
            const fixed = parseUsdcToMicros(body.introPriceUsdc);
            const { introductoryAmountUsdc } = computeIntroductoryAmount({
                discountType: "FIXED_PRICE",
                regularAmountUsdc,
                fixedIntroAmountUsdc: fixed,
            });
            return { ok: true, discountType: "FIXED_PRICE", discountBps: null, introductoryAmountUsdc, introductoryCycles };
        }
        return { ok: true, discountType: "FREE_TRIAL", discountBps: null, introductoryAmountUsdc: BigInt(0), introductoryCycles };
    } catch (err: any) {
        return { ok: false, error: err?.message || "Invalid discount configuration" };
    }
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const planId = new URL(request.url).searchParams.get("planId");
        const promotions = await prisma.merchantPlanPromotion.findMany({
            where: {
                merchantAddress: wallet.toLowerCase(),
                ...(planId ? { planId } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        return NextResponse.json({ success: true, promotions: promotions.map(formatPromotion) }, { status: 200 });
    } catch (error: any) {
        console.error("List promotions failed:", error);
        return NextResponse.json({ error: error.message || "Failed to list promotions" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LEN) : "";
        if (!name) return NextResponse.json({ error: "Promotion name is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || plan.merchantAddress.toLowerCase() !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }
        if (!plan.active) {
            return NextResponse.json({ error: "Promotions can only be attached to active plans" }, { status: 400 });
        }

        const pricing = buildPricingTerms(body, plan.amountUsdc);
        if (!pricing.ok) return NextResponse.json({ error: pricing.error }, { status: 400 });

        const startsAt = parseOptionalDate(body.startsAt, "startsAt");
        if (!startsAt.ok) return NextResponse.json({ error: startsAt.error }, { status: 400 });
        const expiresAt = parseOptionalDate(body.expiresAt, "expiresAt");
        if (!expiresAt.ok) return NextResponse.json({ error: expiresAt.error }, { status: 400 });
        if (startsAt.value && expiresAt.value && startsAt.value >= expiresAt.value) {
            return NextResponse.json({ error: "expiresAt must be after startsAt" }, { status: 400 });
        }

        let maxRedemptions: number | null = null;
        if (body.maxRedemptions !== undefined && body.maxRedemptions !== null && body.maxRedemptions !== "") {
            const parsed = Number(body.maxRedemptions);
            if (!Number.isInteger(parsed) || parsed < 1) {
                return NextResponse.json({ error: "maxRedemptions must be a positive integer" }, { status: 400 });
            }
            maxRedemptions = parsed;
        }

        const promotion = await prisma.merchantPlanPromotion.create({
            data: {
                merchantAddress: wallet.toLowerCase(),
                planId,
                name,
                discountType: pricing.discountType,
                discountBps: pricing.discountBps,
                regularAmountUsdc: plan.amountUsdc,
                introductoryAmountUsdc: pricing.introductoryAmountUsdc,
                introductoryCycles: pricing.introductoryCycles,
                startsAt: startsAt.value,
                expiresAt: expiresAt.value,
                maxRedemptions,
                newCustomersOnly: body.newCustomersOnly === undefined ? true : !!body.newCustomersOnly,
            },
        });
        return NextResponse.json({ success: true, promotion: formatPromotion(promotion) }, { status: 201 });
    } catch (error: any) {
        if (error?.code === "P2002") {
            return NextResponse.json(
                { error: "This plan already has an active promotion. Deactivate it first or edit it instead.", code: "ACTIVE_PROMOTION_EXISTS" },
                { status: 409 },
            );
        }
        console.error("Create promotion failed:", error);
        return NextResponse.json({ error: error.message || "Failed to create promotion" }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const promotionId = typeof body.promotionId === "string" ? body.promotionId : "";
        if (!promotionId) return NextResponse.json({ error: "promotionId is required" }, { status: 400 });

        const promotion = await prisma.merchantPlanPromotion.findUnique({ where: { id: promotionId } });
        if (!promotion || promotion.merchantAddress.toLowerCase() !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
        }

        const data: Record<string, unknown> = {};

        if (body.active !== undefined) data.active = !!body.active;
        if (body.name !== undefined) {
            const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LEN) : "";
            if (!name) return NextResponse.json({ error: "Promotion name cannot be empty" }, { status: 400 });
            data.name = name;
        }
        if (body.newCustomersOnly !== undefined) data.newCustomersOnly = !!body.newCustomersOnly;

        if (body.startsAt !== undefined) {
            const startsAt = parseOptionalDate(body.startsAt, "startsAt");
            if (!startsAt.ok) return NextResponse.json({ error: startsAt.error }, { status: 400 });
            data.startsAt = startsAt.value;
        }
        if (body.expiresAt !== undefined) {
            const expiresAt = parseOptionalDate(body.expiresAt, "expiresAt");
            if (!expiresAt.ok) return NextResponse.json({ error: expiresAt.error }, { status: 400 });
            data.expiresAt = expiresAt.value;
        }
        const effectiveStart = (data.startsAt !== undefined ? data.startsAt : promotion.startsAt) as Date | null;
        const effectiveEnd = (data.expiresAt !== undefined ? data.expiresAt : promotion.expiresAt) as Date | null;
        if (effectiveStart && effectiveEnd && effectiveStart >= effectiveEnd) {
            return NextResponse.json({ error: "expiresAt must be after startsAt" }, { status: 400 });
        }

        if (body.maxRedemptions !== undefined) {
            if (body.maxRedemptions === null || body.maxRedemptions === "") {
                data.maxRedemptions = null;
            } else {
                const parsed = Number(body.maxRedemptions);
                if (!Number.isInteger(parsed) || parsed < 1) {
                    return NextResponse.json({ error: "maxRedemptions must be a positive integer" }, { status: 400 });
                }
                data.maxRedemptions = parsed;
            }
        }

        /* Re-pricing: allowed at any time — the change applies only to future subscribers,
           because every subscription snapshots its authorized terms at signup. */
        if (body.discountType !== undefined || body.percentOff !== undefined
            || body.introPriceUsdc !== undefined || body.introductoryCycles !== undefined) {
            const plan = await prisma.merchantPlan.findUnique({ where: { id: promotion.planId } });
            if (!plan) return NextResponse.json({ error: "Underlying plan no longer exists" }, { status: 404 });
            /* Unspecified fields fall back to the promotion's stored terms so a partial edit
               (e.g. only the cycle count) never drops the price configuration. */
            const storedIntroUsdc = `${promotion.introductoryAmountUsdc / BigInt(1_000_000)}.${(promotion.introductoryAmountUsdc % BigInt(1_000_000)).toString().padStart(6, "0")}`;
            const pricing = buildPricingTerms({
                discountType: body.discountType ?? promotion.discountType,
                percentOff: body.percentOff ?? (promotion.discountBps !== null ? promotion.discountBps / 100 : undefined),
                introPriceUsdc: body.introPriceUsdc ?? storedIntroUsdc,
                introductoryCycles: body.introductoryCycles ?? promotion.introductoryCycles,
            }, plan.amountUsdc);
            if (!pricing.ok) return NextResponse.json({ error: pricing.error }, { status: 400 });
            data.discountType = pricing.discountType;
            data.discountBps = pricing.discountBps;
            data.introductoryAmountUsdc = pricing.introductoryAmountUsdc;
            data.introductoryCycles = pricing.introductoryCycles;
            data.regularAmountUsdc = plan.amountUsdc;
        }

        const updated = await prisma.merchantPlanPromotion.update({
            where: { id: promotionId },
            data,
        });
        return NextResponse.json({ success: true, promotion: formatPromotion(updated) }, { status: 200 });
    } catch (error: any) {
        if (error?.code === "P2002") {
            return NextResponse.json(
                { error: "This plan already has an active promotion.", code: "ACTIVE_PROMOTION_EXISTS" },
                { status: 409 },
            );
        }
        console.error("Update promotion failed:", error);
        return NextResponse.json({ error: error.message || "Failed to update promotion" }, { status: 500 });
    }
}
