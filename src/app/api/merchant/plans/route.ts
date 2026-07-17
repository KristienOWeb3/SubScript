/* Merchant-defined subscription plans. Merchants create/list/deactivate named tiers;
   users fetch a merchant's active plans to subscribe/upgrade from within a DM. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { parseUsdcToMicros } from "@/lib/dms/system";
import {
    lockMerchantPlanCatalog,
    MAX_ACTIVE_MERCHANT_PLANS,
    publishSitePlanFromCheckout,
    SitePlanPublicationError,
} from "@/lib/subscriptions/sitePlans";
import { formatPromotion, isPromotionLive, type PromotionRow } from "@/lib/subscriptions/promotions";

const MAX_DESCRIPTION_LEN = 300;

function formatPlan(p: any) {
    return {
        id: p.id,
        merchantAddress: p.merchantAddress,
        name: p.name,
        description: p.description ?? null,
        detailsUrl: p.detailsUrl ?? null,
        amountUsdc: p.amountUsdc.toString(),
        periodSeconds: p.periodSeconds.toString(),
        minCommitmentSeconds: (p.minCommitmentSeconds ?? BigInt(0)).toString(),
        active: p.active,
    };
}

/* Normalize an optional customer-facing description: trim, cap at 300 chars,
   empty -> null. Returns { ok, value } or { ok: false, error }. */
function normalizeDescription(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, value: null };
    if (typeof raw !== "string") return { ok: false, error: "description must be a string" };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: null };
    if (trimmed.length > MAX_DESCRIPTION_LEN) {
        return { ok: false, error: `Description must be ${MAX_DESCRIPTION_LEN} characters or fewer` };
    }
    return { ok: true, value: trimmed };
}

/* Normalize an optional "view more" link: must be a well-formed http(s) URL so a
   merchant can't smuggle a javascript:/data: scheme into a clickable customer link. */
function normalizeDetailsUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, value: null };
    if (typeof raw !== "string") return { ok: false, error: "detailsUrl must be a string" };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: null };
    if (trimmed.length > 500) return { ok: false, error: "Details link is too long" };
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: "Details link must be a valid URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Details link must start with http:// or https://" };
    }
    return { ok: true, value: parsed.toString() };
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const merchantParam = new URL(request.url).searchParams.get("merchantAddress");

        // A user fetching a specific merchant's plans (the DM picker) sees ACTIVE plans only,
        // each carrying its live introductory promotion (if any) so checkout can disclose
        // both the due-today price and the recurring price before authorization.
        if (merchantParam && ethers.isAddress(merchantParam)) {
            const plans = await prisma.merchantPlan.findMany({
                where: { merchantAddress: merchantParam.toLowerCase(), active: true },
                orderBy: { amountUsdc: "asc" },
            });
            const promotions = plans.length > 0
                ? await prisma.merchantPlanPromotion.findMany({
                    where: { planId: { in: plans.map((p) => p.id) }, active: true },
                })
                : [];
            const liveByPlan = new Map(
                promotions
                    .filter((promo) => isPromotionLive(promo as PromotionRow))
                    .map((promo) => [promo.planId, formatPromotion(promo as PromotionRow)]),
            );
            return NextResponse.json({
                success: true,
                plans: plans.map((p) => ({ ...formatPlan(p), promotion: liveByPlan.get(p.id) ?? null })),
            }, { status: 200 });
        }

        // Otherwise the merchant lists their own plans (all states).
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        const plans = await prisma.merchantPlan.findMany({
            where: { merchantAddress: wallet.toLowerCase() },
            orderBy: { createdAt: "desc" },
        });
        return NextResponse.json({ success: true, plans: plans.map(formatPlan) }, { status: 200 });
    } catch (error: any) {
        console.error("List plans failed:", error);
        return NextResponse.json({ error: error.message || "Failed to list plans" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const checkoutSessionId = typeof body.checkoutSessionId === "string"
            ? body.checkoutSessionId.trim()
            : "";

        /* Publishing a site checkout is an explicit merchant action. Customer-facing GETs are
           read-only and can never infer a public catalog entry from a private checkout attempt. */
        if (checkoutSessionId) {
            const published = await publishSitePlanFromCheckout(wallet, checkoutSessionId);
            return NextResponse.json(
                { success: true, plan: formatPlan(published.plan), created: published.created },
                { status: published.created ? 201 : 200 },
            );
        }

        const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
        if (!name) return NextResponse.json({ error: "Plan name is required" }, { status: 400 });

        const descriptionResult = normalizeDescription(body.description);
        if (!descriptionResult.ok) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });

        const detailsUrlResult = normalizeDetailsUrl(body.detailsUrl);
        if (!detailsUrlResult.ok) return NextResponse.json({ error: detailsUrlResult.error }, { status: 400 });

        const amountUsdc = parseUsdcToMicros(body.amountUsdc);
        if (amountUsdc <= BigInt(0)) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

        const periodDays = Number(body.periodDays);
        if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 366) {
            return NextResponse.json({ error: "Billing period must be between 1 and 366 days" }, { status: 400 });
        }
        const periodSeconds = BigInt(Math.round(periodDays) * 24 * 60 * 60);

        /* Optional minimum-commitment window, disclosed on the subscribe page before
           authorization. Protocol ceilings: never more than one billing period, never more
           than 30 days — an early cancel then simply takes effect at period end, so the
           commitment can never extend billing beyond what the subscriber already approved. */
        let minCommitmentSeconds = BigInt(0);
        if (body.minCommitmentDays !== undefined && body.minCommitmentDays !== null && body.minCommitmentDays !== "") {
            const days = Number(body.minCommitmentDays);
            if (!Number.isFinite(days) || days < 0) {
                return NextResponse.json({ error: "minCommitmentDays must be zero or a positive number of days" }, { status: 400 });
            }
            const capDays = Math.min(30, Math.round(periodDays));
            if (days > capDays) {
                return NextResponse.json({ error: `Minimum commitment cannot exceed ${capDays} days for this plan (one billing period, capped at 30 days).` }, { status: 400 });
            }
            minCommitmentSeconds = BigInt(Math.round(days * 24 * 60 * 60));
        }

        const merchantAddress = wallet.toLowerCase();
        const result = await prisma.$transaction(async (tx) => {
            /* Serialize every catalog insertion for this merchant so concurrent manual and
               checkout publications cannot both pass the active-plan ceiling. */
            await lockMerchantPlanCatalog(tx, merchantAddress);
            const activeCount = await tx.merchantPlan.count({
                where: { merchantAddress, active: true },
            });
            if (activeCount >= MAX_ACTIVE_MERCHANT_PLANS) {
                return { limitReached: true as const };
            }
            const plan = await tx.merchantPlan.create({
                data: {
                    merchantAddress,
                    name,
                    description: descriptionResult.value,
                    detailsUrl: detailsUrlResult.value,
                    amountUsdc,
                    periodSeconds,
                    minCommitmentSeconds,
                },
            });
            return { limitReached: false as const, plan };
        });
        if (result.limitReached) {
            return NextResponse.json(
                { error: `You can have at most ${MAX_ACTIVE_MERCHANT_PLANS} active plans.` },
                { status: 403 },
            );
        }
        return NextResponse.json({ success: true, plan: formatPlan(result.plan) }, { status: 201 });
    } catch (error: any) {
        if (error instanceof SitePlanPublicationError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        if (error?.code === "P2002" && error?.meta?.target?.includes?.("source_checkout_id")) {
            return NextResponse.json(
                { error: "This checkout has already been published as a plan.", code: "SOURCE_CONFLICT" },
                { status: 409 },
            );
        }
        console.error("Create plan failed:", error);
        return NextResponse.json({ error: error.message || "Failed to create plan" }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || plan.merchantAddress.toLowerCase() !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }

        const data: { active: boolean; description?: string | null; detailsUrl?: string | null } = {
            active: body.active === undefined ? plan.active : !!body.active,
        };
        if (body.description !== undefined) {
            const descriptionResult = normalizeDescription(body.description);
            if (!descriptionResult.ok) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });
            data.description = descriptionResult.value;
        }
        if (body.detailsUrl !== undefined) {
            const detailsUrlResult = normalizeDetailsUrl(body.detailsUrl);
            if (!detailsUrlResult.ok) return NextResponse.json({ error: detailsUrlResult.error }, { status: 400 });
            data.detailsUrl = detailsUrlResult.value;
        }

        const updated = await prisma.merchantPlan.update({
            where: { id: planId },
            data,
        });
        return NextResponse.json({ success: true, plan: formatPlan(updated) }, { status: 200 });
    } catch (error: any) {
        console.error("Update plan failed:", error);
        return NextResponse.json({ error: error.message || "Failed to update plan" }, { status: 500 });
    }
}
