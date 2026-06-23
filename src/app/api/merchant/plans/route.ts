/* Merchant-defined subscription plans. Merchants create/list/deactivate named tiers;
   users fetch a merchant's active plans to subscribe/upgrade from within a DM. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { getAccountRole, requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { parseUsdcToMicros } from "@/lib/dms/system";

function formatPlan(p: any) {
    return {
        id: p.id,
        merchantAddress: p.merchantAddress,
        name: p.name,
        amountUsdc: p.amountUsdc.toString(),
        periodSeconds: p.periodSeconds.toString(),
        active: p.active,
    };
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const merchantParam = new URL(request.url).searchParams.get("merchantAddress");

        // A user fetching a specific merchant's plans (the DM picker) sees ACTIVE plans only.
        if (merchantParam && ethers.isAddress(merchantParam)) {
            const plans = await prisma.merchantPlan.findMany({
                where: { merchantAddress: merchantParam.toLowerCase(), active: true },
                orderBy: { amountUsdc: "asc" },
            });
            return NextResponse.json({ success: true, plans: plans.map(formatPlan) }, { status: 200 });
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

const MAX_PLANS = 20;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
        if (!name) return NextResponse.json({ error: "Plan name is required" }, { status: 400 });

        const amountUsdc = parseUsdcToMicros(body.amountUsdc);
        if (amountUsdc <= BigInt(0)) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

        const periodDays = Number(body.periodDays);
        if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 366) {
            return NextResponse.json({ error: "Billing period must be between 1 and 366 days" }, { status: 400 });
        }
        const periodSeconds = BigInt(Math.round(periodDays) * 24 * 60 * 60);

        const activeCount = await prisma.merchantPlan.count({
            where: { merchantAddress: wallet.toLowerCase(), active: true },
        });
        if (activeCount >= MAX_PLANS) {
            return NextResponse.json({ error: `You can have at most ${MAX_PLANS} active plans.` }, { status: 403 });
        }

        const plan = await prisma.merchantPlan.create({
            data: { merchantAddress: wallet.toLowerCase(), name, amountUsdc, periodSeconds },
        });
        return NextResponse.json({ success: true, plan: formatPlan(plan) }, { status: 201 });
    } catch (error: any) {
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
        const updated = await prisma.merchantPlan.update({
            where: { id: planId },
            data: { active: body.active === undefined ? plan.active : !!body.active },
        });
        return NextResponse.json({ success: true, plan: formatPlan(updated) }, { status: 200 });
    } catch (error: any) {
        console.error("Update plan failed:", error);
        return NextResponse.json({ error: error.message || "Failed to update plan" }, { status: 500 });
    }
}
