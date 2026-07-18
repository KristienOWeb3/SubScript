import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole, getAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { normalizeMicrouscAmount } from "@/lib/paymentLinks/validation";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { generateReceiptId } from "@/lib/arc/memo";
import { ProtocolConfig } from "@/lib/payments/config";

const MAX_PENDING_SPONSORED_REQUESTS = 10;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function shortAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
    const raw = typeof value === "string" ? sanitizeInput(value) : "";
    const trimmed = raw.trim();
    return (trimmed || fallback).slice(0, maxLength);
}

function amountCandidate(body: Record<string, unknown>) {
    return body.amountUsdcMicros ?? body.amount_usdc_micros ?? body.amountUsdc ?? body.amount_usdc;
}

function sponsoredSnapshot(plan: { id: string; name: string; periodSeconds: bigint }) {
    return {
        isSponsored: true,
        sponsoredPlanId: plan.id,
        sponsoredPlanName: plan.name,
        durationSeconds: Number(plan.periodSeconds),
    };
}

function sponsoredResponse(link: { id: string }, reused = false) {
    return {
        success: true,
        paymentLinkId: link.id,
        checkoutUrl: buildCheckoutUrl(link.id),
        reused,
    };
}

export async function POST(request: Request) {
    try {
        const requester = await getSessionWallet(request.headers);
        if (!requester) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const roleCheck = await requireAccountRole(requester, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const normalizedRequester = requester.toLowerCase();
        const merchantAddress = typeof body.merchantAddress === "string" ? body.merchantAddress.trim().toLowerCase() : "";
        if (!ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "merchantAddress must be a valid EVM address" }, { status: 400 });
        }
        if (merchantAddress === normalizedRequester) {
            return NextResponse.json({ error: "You cannot sponsor your own merchant plan" }, { status: 400 });
        }

        const planId = typeof body.planId === "string" ? body.planId.trim() : "";
        if (!planId) {
            return NextResponse.json({ error: "planId is required" }, { status: 400 });
        }

        const requestedAmount = amountCandidate(body);
        const amountResult = normalizeMicrouscAmount(requestedAmount);
        if (!amountResult.ok) {
            return NextResponse.json({ error: `Bad Request: amountUsdcMicros ${amountResult.error}` }, { status: 400 });
        }

        const [merchant, merchantRole, plan] = await Promise.all([
            prisma.merchant.findUnique({
                where: { walletAddress: merchantAddress },
                select: { walletAddress: true },
            }),
            getAccountRole(merchantAddress),
            prisma.merchantPlan.findUnique({
                where: { id: planId },
                select: {
                    id: true,
                    merchantAddress: true,
                    sourceCheckoutId: true,
                    targetSubscriber: true,
                    name: true,
                    description: true,
                    amountUsdc: true,
                    periodSeconds: true,
                    active: true,
                },
            }),
        ]);

        if (!merchant || merchantRole !== "ENTERPRISE") {
            return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
        }
        if (!plan || !plan.active || plan.merchantAddress.toLowerCase() !== merchantAddress) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }
        if (plan.targetSubscriber && plan.targetSubscriber.toLowerCase() !== normalizedRequester) {
            return NextResponse.json({ error: "This plan is assigned to another subscriber" }, { status: 403 });
        }
        if (amountResult.value !== plan.amountUsdc) {
            return NextResponse.json({ error: "Bad Request: requested amount does not match the merchant plan price" }, { status: 400 });
        }

        const pendingCount = await prisma.paymentLink.count({
            where: {
                beneficiaryAddress: normalizedRequester,
                active: true,
                useCount: 0,
                status: "PENDING",
                stateSnapshot: { path: ["isSponsored"], equals: true },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
        });
        if (pendingCount >= MAX_PENDING_SPONSORED_REQUESTS) {
            return NextResponse.json({ error: "Too many active pending sponsored checkout links" }, { status: 429 });
        }

        const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
        const existing = await prisma.paymentLink.findFirst({
            where: {
                beneficiaryAddress: normalizedRequester,
                active: true,
                useCount: 0,
                status: "PENDING",
                createdAt: { gte: dedupeSince },
                expiresAt: { gt: new Date() },
                stateSnapshot: { path: ["sponsoredPlanId"], equals: plan.id },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (existing) {
            return NextResponse.json(sponsoredResponse(existing, true), { status: 200 });
        }

        const requesterAlias = await prisma.addressAlias.findUnique({
            where: { address: normalizedRequester },
            select: { alias: true, isAnonymous: true },
        });
        const requesterLabel = requesterAlias?.alias && !requesterAlias.isAnonymous
            ? `@${requesterAlias.alias}`
            : shortAddress(normalizedRequester);

        const friendUsername = typeof body.friendUsername === "string"
            ? body.friendUsername.trim().replace(/^@/, "")
            : "";
        let receiverAddress: string | null = null;
        if (friendUsername) {
            const friendAlias = await prisma.addressAlias.findUnique({
                where: { alias: friendUsername },
                select: { address: true },
            });
            if (!friendAlias) {
                return NextResponse.json({ error: "Friend username was not found" }, { status: 404 });
            }
            receiverAddress = friendAlias.address.toLowerCase();
            const friendRole = await getAccountRole(receiverAddress);
            if (friendRole !== "USER") {
                return NextResponse.json({ error: "Friend username must belong to a SubScript user" }, { status: 400 });
            }
        }

        const sourceCheckout = plan.sourceCheckoutId
            ? await prisma.paymentLink.findUnique({
                where: { id: plan.sourceCheckoutId },
                select: { sandboxMode: true, simulationOnly: true, settlementChainId: true },
            })
            : null;
        const title = cleanText(
            body.title,
            `Sponsor ${plan.name} for ${requesterLabel}`,
            120,
        );
        const description = cleanText(
            body.description,
            `One-time sponsored checkout for ${plan.name}. Access should be credited to ${normalizedRequester}.`,
            500,
        );
        const expiresAt = new Date(Date.now() + LINK_TTL_MS);
        const settlementChainId = sourceCheckout?.settlementChainId ?? BigInt(ProtocolConfig.CHAIN_ID);
        const stateSnapshot = sponsoredSnapshot(plan);

        const link = await prisma.paymentLink.create({
            data: {
                merchantAddress,
                title,
                description,
                amountUsdc: plan.amountUsdc,
                active: true,
                expiresAt,
                externalReference: `sponsor-plan:${plan.id}:${normalizedRequester}:${Date.now()}`,
                receiptToken: generateReceiptId(title),
                merchantNameSnapshot: title,
                maxUses: 1,
                beneficiaryAddress: normalizedRequester,
                receiverAddress,
                linkKind: "MERCHANT",
                sandboxMode: sourceCheckout?.sandboxMode ?? false,
                simulationOnly: sourceCheckout?.simulationOnly ?? false,
                settlementChainId,
                stateSnapshot,
                creationFingerprint: {
                    ...stateSnapshot,
                    merchantAddress,
                    amountUsdc: plan.amountUsdc.toString(),
                    beneficiaryAddress: normalizedRequester,
                    receiverAddress,
                    maxUses: 1,
                    expiresAt: expiresAt.toISOString(),
                    settlementChainId: settlementChainId.toString(),
                },
            },
            select: { id: true },
        });

        return NextResponse.json(sponsoredResponse(link), { status: 201 });
    } catch (error: any) {
        console.error("Sponsored merchant-plan request failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
