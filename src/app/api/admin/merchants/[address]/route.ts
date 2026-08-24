import { NextResponse } from "next/server";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ address: string }> }
) {
    const auth = await requireScope(request, "support");
    if (!auth.ok) return auth.response;

    const { address } = await params;
    if (!address || !ethers.isAddress(address)) {
        return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();

    try {
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        if (!merchant) {
            return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
        }

        /* 1. Live plans & payment links */
        const plans = await prisma.merchantPlan.findMany({
            where: { merchantAddress: normalizedAddress },
            orderBy: { createdAt: "desc" },
        });

        const paymentLinks = await prisma.paymentLink.findMany({
            where: { merchantAddress: normalizedAddress },
            orderBy: { createdAt: "desc" },
            take: 30,
        });

        /* 2. API keys inventory */
        const apiKeys = await prisma.apiKey.findMany({
            where: { walletAddress: normalizedAddress },
            select: {
                id: true,
                publishableKey: true,
                secretKeyHint: true,
                mode: true,
                revoked: true,
                createdAt: true,
            },
        });

        /* 3. Webhook endpoints and deliveries */
        const webhookEndpoints = await prisma.webhookEndpoint.findMany({
            where: { walletAddress: normalizedAddress },
            select: {
                id: true,
                url: true,
                active: true,
                environment: true,
                enabledEvents: true,
                status: true,
                createdAt: true,
            },
        });

        const endpointIds = webhookEndpoints.map((e) => e.id);
        const webhookDeliveries = await prisma.webhookDelivery.findMany({
            where: { webhookEndpointId: { in: endpointIds } },
            orderBy: { createdAt: "desc" },
            take: 20,
        });

        return NextResponse.json({
            success: true,
            merchant: {
                walletAddress: merchant.walletAddress,
                tier: merchant.tier,
                verified: merchant.verified,
                availableBalanceUsdc: (Number(merchant.availableBalanceUsdc) / 1_000_000).toFixed(2),
                reservedBalanceUsdc: (Number(merchant.reservedBalanceUsdc) / 1_000_000).toFixed(2),
                payoutDestination: merchant.payoutDestination,
                churnSurveyQuestion: merchant.churnSurveyQuestion,
                churnSurveyEnabled: merchant.churnSurveyEnabled,
                createdAt: merchant.createdAt,
            },
            plans: plans.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                amountUsdc: (Number(p.amountUsdc) / 1_000_000).toFixed(2),
                periodSeconds: p.periodSeconds.toString(),
                active: p.active,
                createdAt: p.createdAt,
            })),
            paymentLinks: paymentLinks.map((l) => ({
                id: l.id,
                title: l.title,
                amountUsdc: (Number(l.amountUsdc) / 1_000_000).toFixed(2),
                active: l.active,
                useCount: l.useCount,
                maxUses: l.maxUses,
                receiptToken: l.receiptToken,
                createdAt: l.createdAt,
            })),
            apiKeys,
            webhookEndpoints,
            webhookDeliveries: webhookDeliveries.map((d) => ({
                id: d.id,
                event: d.event,
                status: d.status,
                attempts: d.attempts,
                httpStatus: d.httpStatus,
                lastError: d.lastError,
                createdAt: d.createdAt,
            })),
        });

    } catch (error: any) {
        console.error(`[admin/merchants/${normalizedAddress}] error:`, error);
        return NextResponse.json({ error: error.message || "Failed to load merchant details" }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ address: string }> }
) {
    const auth = await requireScope(request, "support");
    if (!auth.ok) return auth.response;

    const { address } = await params;
    if (!address || !ethers.isAddress(address)) {
        return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();

    try {
        const body = await request.json().catch(() => ({}));
        const { action, targetId, reason } = body;

        switch (action) {
            case "takedown_link": {
                if (!targetId) return NextResponse.json({ error: "Missing link targetId" }, { status: 400 });
                await prisma.paymentLink.update({
                    where: { id: targetId },
                    data: { active: false },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "PRODUCT_TAKEDOWN",
                    target: targetId,
                    detail: { merchantAddress: normalizedAddress, reason: reason || "Admin link takedown" },
                    request,
                });

                return NextResponse.json({ success: true, message: `Payment link ${targetId} deactivated.` });
            }

            case "takedown_plan": {
                if (!targetId) return NextResponse.json({ error: "Missing plan targetId" }, { status: 400 });
                await prisma.merchantPlan.update({
                    where: { id: targetId },
                    data: { active: false },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "PLAN_TAKEDOWN",
                    target: targetId,
                    detail: { merchantAddress: normalizedAddress, reason: reason || "Admin plan takedown" },
                    request,
                });

                return NextResponse.json({ success: true, message: `Merchant plan ${targetId} deactivated.` });
            }

            case "revoke_key": {
                if (!targetId) return NextResponse.json({ error: "Missing apiKey targetId" }, { status: 400 });
                await prisma.apiKey.update({
                    where: { id: targetId },
                    data: { revoked: true },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "API_KEY_REVOKE",
                    target: targetId,
                    detail: { merchantAddress: normalizedAddress, reason: reason || "Admin key revocation" },
                    request,
                });

                return NextResponse.json({ success: true, message: `API key ${targetId} revoked.` });
            }

            case "redeliver_webhook": {
                if (!targetId) return NextResponse.json({ error: "Missing delivery targetId" }, { status: 400 });
                await prisma.webhookDelivery.update({
                    where: { id: targetId },
                    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "WEBHOOK_REDELIVER",
                    target: targetId,
                    detail: { merchantAddress: normalizedAddress },
                    request,
                });

                return NextResponse.json({ success: true, message: `Webhook delivery queued for retry.` });
            }

            default:
                return NextResponse.json({ error: `Unsupported merchant action: ${action}` }, { status: 400 });
        }

    } catch (error: any) {
        console.error(`[admin/merchants/${normalizedAddress}/action] error:`, error);
        return NextResponse.json({ error: error.message || "Failed to execute merchant action" }, { status: 500 });
    }
}
