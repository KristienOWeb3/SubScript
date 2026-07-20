/* Public API for the merchant plan catalog — the SAME merchant_plans table the dashboard
 * Plans tab and the DM plan picker read. A plan created here appears in the dashboard and
 * in customer DMs immediately, and vice versa.
 *
 * This is distinct from POST /api/v1/subscriptions, which creates a one-off subscription
 * CHECKOUT session (an attempt, not a catalog entry). Use plans for your published tiers;
 * pass their planId to /api/v1/subscriptions to generate checkouts against them.
 */
import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiErrors";
import { authenticateMerchant, requireEnterpriseAndPremium } from "@/lib/v1/merchantAuth";
import { sanitizeInput } from "@/utils/security";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { buildSubscribeUrl } from "@/lib/checkoutUrl";
import { lockMerchantPlanCatalog, MAX_ACTIVE_MERCHANT_PLANS } from "@/lib/subscriptions/sitePlans";
import { formatPromotion, isPromotionLive, type PromotionRow } from "@/lib/subscriptions/promotions";
import { DEMO_MERCHANT_ADDRESS } from "@/lib/contracts/constants";

const MAX_DESCRIPTION_LEN = 300;

function formatPlan(plan: any, promotion: PromotionRow | null) {
    return {
        id: plan.id,
        object: "plan",
        name: plan.name,
        description: plan.description ?? null,
        detailsUrl: plan.detailsUrl ?? null,
        merchantAddress: plan.merchantAddress,
        amountUsdc: formatUnits(plan.amountUsdc, 6),
        amountUsdcMicros: plan.amountUsdc.toString(),
        periodSeconds: Number(plan.periodSeconds),
        minCommitmentSeconds: Number(plan.minCommitmentSeconds ?? 0),
        active: plan.active,
        subscribeUrl: buildSubscribeUrl(plan.id),
        promotion: promotion ? formatPromotion(promotion) : null,
        createdAt: plan.createdAt,
    };
}

function normalizeDescription(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, value: null };
    if (typeof raw !== "string") return { ok: false, error: "description must be a string" };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: null };
    if (trimmed.length > MAX_DESCRIPTION_LEN) {
        return { ok: false, error: `description must be ${MAX_DESCRIPTION_LEN} characters or fewer` };
    }
    return { ok: true, value: trimmed };
}

function normalizeDetailsUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, value: null };
    if (typeof raw !== "string") return { ok: false, error: "detailsUrl must be a string" };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: null };
    if (trimmed.length > 500) return { ok: false, error: "detailsUrl is too long" };
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: "detailsUrl must be a valid URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "detailsUrl must start with http:// or https://" };
    }
    return { ok: true, value: parsed.toString() };
}

async function attachPromotions(plans: any[]) {
    if (plans.length === 0) return new Map<string, PromotionRow>();
    const promotions = await prisma.merchantPlanPromotion.findMany({
        where: { planId: { in: plans.map((p) => p.id) }, active: true },
    });
    return new Map(
        promotions
            .filter((promo) => isPromotionLive(promo as PromotionRow))
            .map((promo) => [promo.planId, promo as PromotionRow]),
    );
}

/* GET /api/v1/plans[?active=true] — list this merchant's catalog plans. */
export async function GET(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });

        const activeParam = new URL(request.url).searchParams.get("active");
        const plans = await prisma.merchantPlan.findMany({
            where: {
                merchantAddress: auth.merchantAddress,
                ...(activeParam === "true" ? { active: true } : activeParam === "false" ? { active: false } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        const promoByPlan = await attachPromotions(plans);
        return NextResponse.json({
            object: "list",
            data: plans.map((plan) => formatPlan(plan, promoByPlan.get(plan.id) ?? null)),
        }, { status: 200 });
    } catch (error) {
        console.error("Plans GET error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}

/* POST /api/v1/plans — create a catalog plan.
   Body: { name, amountUsdc | amountUsdcMicros, periodDays | intervalSeconds,
           description?, detailsUrl?, minCommitmentDays? } */
export async function POST(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        const merchantAddress = auth.merchantAddress;
        if (auth.mode === "test" && merchantAddress === DEMO_MERCHANT_ADDRESS.toLowerCase()) {
            return apiError({
                status: 403,
                code: "demo_key_simulation_only",
                message: "The shared public demo key cannot modify the plan catalog. Create your own test key.",
            });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};

        const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
        if (!name) return NextResponse.json({ error: "Bad Request: name is required" }, { status: 400 });

        const descriptionResult = normalizeDescription(body.description);
        if (!descriptionResult.ok) return NextResponse.json({ error: `Bad Request: ${descriptionResult.error}` }, { status: 400 });
        const detailsUrlResult = normalizeDetailsUrl(body.detailsUrl);
        if (!detailsUrlResult.ok) return NextResponse.json({ error: `Bad Request: ${detailsUrlResult.error}` }, { status: 400 });

        let amountUsdc: bigint;
        try {
            if (body.amountUsdcMicros !== undefined && body.amountUsdcMicros !== null && body.amountUsdcMicros !== "") {
                const source = String(body.amountUsdcMicros).trim();
                if (!/^\d+$/.test(source)) throw new Error("invalid amountUsdcMicros");
                amountUsdc = BigInt(source);
            } else {
                amountUsdc = parseUsdcToMicros(body.amountUsdc);
            }
        } catch (err: any) {
            return NextResponse.json({ error: `Bad Request: ${err?.message || "invalid amount"}` }, { status: 400 });
        }
        if (amountUsdc <= BigInt(0)) return NextResponse.json({ error: "Bad Request: amount must be greater than 0" }, { status: 400 });

        /* Same period ceilings as the dashboard: 1–366 days. */
        let periodSeconds: bigint;
        if (body.periodDays !== undefined && body.periodDays !== null && body.periodDays !== "") {
            const periodDays = Number(body.periodDays);
            if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 366) {
                return NextResponse.json({ error: "Bad Request: periodDays must be between 1 and 366" }, { status: 400 });
            }
            periodSeconds = BigInt(Math.round(periodDays) * 86_400);
        } else if (body.intervalSeconds !== undefined && body.intervalSeconds !== null && body.intervalSeconds !== "") {
            const seconds = Number(body.intervalSeconds);
            if (!Number.isSafeInteger(seconds) || seconds < 86_400 || seconds > 366 * 86_400) {
                return NextResponse.json({ error: "Bad Request: intervalSeconds must be between 86400 (1 day) and 31622400 (366 days)" }, { status: 400 });
            }
            periodSeconds = BigInt(seconds);
        } else {
            return NextResponse.json({ error: "Bad Request: provide periodDays or intervalSeconds" }, { status: 400 });
        }

        let minCommitmentSeconds = BigInt(0);
        if (body.minCommitmentDays !== undefined && body.minCommitmentDays !== null && body.minCommitmentDays !== "") {
            const days = Number(body.minCommitmentDays);
            const periodDays = Number(periodSeconds) / 86_400;
            const capDays = Math.min(30, Math.round(periodDays));
            if (!Number.isFinite(days) || days < 0 || days > capDays) {
                return NextResponse.json({ error: `Bad Request: minCommitmentDays must be between 0 and ${capDays} (one billing period, capped at 30 days)` }, { status: 400 });
            }
            minCommitmentSeconds = BigInt(Math.round(days * 86_400));
        }

        const result = await prisma.$transaction(async (tx) => {
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
        return NextResponse.json({ success: true, plan: formatPlan(result.plan, null) }, { status: 201 });
    } catch (error) {
        console.error("Plans POST error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}

/* PATCH /api/v1/plans — update a plan: { planId, active?, description?, detailsUrl? }.
   Price and period are immutable (existing subscribers authorized them); create a new
   plan for a new price point. */
export async function PATCH(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        const merchantAddress = auth.merchantAddress;
        if (auth.mode === "test" && merchantAddress === DEMO_MERCHANT_ADDRESS.toLowerCase()) {
            return apiError({
                status: 403,
                code: "demo_key_simulation_only",
                message: "The shared public demo key cannot modify the plan catalog. Create your own test key.",
            });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "Bad Request: planId is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || plan.merchantAddress.toLowerCase() !== merchantAddress) {
            return NextResponse.json({ error: "Plan not found for this merchant" }, { status: 404 });
        }

        const data: { active?: boolean; description?: string | null; detailsUrl?: string | null } = {};
        if (body.active !== undefined) data.active = !!body.active;
        if (body.description !== undefined) {
            const descriptionResult = normalizeDescription(body.description);
            if (!descriptionResult.ok) return NextResponse.json({ error: `Bad Request: ${descriptionResult.error}` }, { status: 400 });
            data.description = descriptionResult.value;
        }
        if (body.detailsUrl !== undefined) {
            const detailsUrlResult = normalizeDetailsUrl(body.detailsUrl);
            if (!detailsUrlResult.ok) return NextResponse.json({ error: `Bad Request: ${detailsUrlResult.error}` }, { status: 400 });
            data.detailsUrl = detailsUrlResult.value;
        }
        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "Bad Request: nothing to update (active, description, detailsUrl)" }, { status: 400 });
        }

        const updated = await prisma.merchantPlan.update({ where: { id: planId }, data });
        const promoByPlan = await attachPromotions([updated]);
        return NextResponse.json({ success: true, plan: formatPlan(updated, promoByPlan.get(updated.id) ?? null) }, { status: 200 });
    } catch (error) {
        console.error("Plans PATCH error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}
