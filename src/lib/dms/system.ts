import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { createDmAndNotify } from "@/lib/dms/notifications";

const USDC_DECIMALS = 1_000_000;

export type SystemDmStatus = "PENDING" | "APPROVED" | "DECLINED" | "DISMISSED";

export function formatUsdcFromMicros(amount: bigint | number | string | null | undefined) {
    if (amount === null || amount === undefined) return "0.00";
    const numeric = typeof amount === "bigint" ? Number(amount) : Number(amount);
    if (!Number.isFinite(numeric)) return "0.00";
    return (numeric / USDC_DECIMALS).toFixed(2);
}

export function parseUsdcToMicros(value: unknown) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value <= 0) throw new Error("Amount must be greater than 0");
        return BigInt(Math.round(value * USDC_DECIMALS));
    }
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("Amount is required");
    }

    const trimmed = value.trim();

    /* Input here is always a HUMAN USDC amount — the dashboard send / request / payment-link / plan
       / vault flows all pass a user-entered USDC value, and the programmatic micro-USDC APIs
       (/intent, /v1/subscriptions, vault report-usage) parse `amountUsdcMicros` themselves and never
       call this. So an integer means whole USDC, exactly like the decimal branch treats "10". The
       previous `> 100_000 ? already-micros : × 1e6` heuristic was an unresolvable unit guess that
       silently under-charged any amount over 100,000 USDC by 1,000,000×. */
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
        throw new Error("Amount must be a USDC value with up to 6 decimals");
    }

    const [whole, fraction = ""] = trimmed.split(".");
    const paddedFraction = fraction.padEnd(6, "0");
    return BigInt(whole) * BigInt(USDC_DECIMALS) + BigInt(paddedFraction);
}

export function isPaymentLinkUnavailable(link: {
    active: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
}) {
    if (!link.active) return "inactive";
    if (link.expiresAt && link.expiresAt < new Date()) return "expired";
    if (link.maxUses !== null && link.useCount >= link.maxUses) return "exhausted";
    return null;
}

/** Human-readable billing cadence from a period in seconds. */
function formatPeriodLabel(periodSeconds: bigint | number | string) {
    const seconds = Number(periodSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return "cycle";
    const days = Math.round(seconds / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
}

/**
 * Open the merchant→user DM thread when a user subscribes to a plan. This is the
 * "opened DM via subscription" marker: once it exists, one-time merchant payments
 * to this user surface as receipt DMs too (see payment-links/verify). Best-effort.
 */
export async function createSubscriptionStartedDm({
    merchantAddress,
    subscriberAddress,
    planName,
    amountUsdc,
    periodSeconds,
    isChange = false,
}: {
    merchantAddress: string;
    subscriberAddress: string;
    planName: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    isChange?: boolean;
}) {
    const merchant = merchantAddress.toLowerCase();
    const subscriber = subscriberAddress.toLowerCase();

    const merchantAlias = await prisma.addressAlias.findUnique({ where: { address: merchant } }).catch(() => null);
    const merchantName = merchantAlias?.alias || `${merchant.slice(0, 6)}...${merchant.slice(-4)}`;
    const amount = formatUsdcFromMicros(amountUsdc);
    const cadence = formatPeriodLabel(periodSeconds);

    const dm = await createDmAndNotify({
        senderAddress: merchant,
        receiverAddress: subscriber,
        messageType: "SUBSCRIPTION_STARTED",
        status: "APPROVED",
        amountUsdc,
        title: isChange ? `Plan changed to ${planName}` : `Subscribed to ${planName}`,
        description: [
            `Merchant: ${merchantName}`,
            `Plan: ${planName}`,
            `Amount: ${amount} USDC / ${cadence}`,
            "You can manage or cancel this subscription anytime from your dashboard.",
        ].join("\n"),
    });

    return dm;
}

/**
 * True if a subscription has opened a merchant→user DM thread (a SUBSCRIPTION_STARTED,
 * EXPIRY_WARNING, or CHURN_SURVEY DM — all subscription-lifecycle only). Used to gate
 * one-time payment receipt DMs so they appear only after a subscription relationship.
 */
export async function hasSubscriptionDmThread(merchantAddress: string, userAddress: string) {
    const existing = await prisma.subscriptDm.findFirst({
        where: {
            senderAddress: merchantAddress.toLowerCase(),
            receiverAddress: userAddress.toLowerCase(),
            messageType: { in: ["SUBSCRIPTION_STARTED", "EXPIRY_WARNING", "CHURN_SURVEY"] },
        },
        select: { id: true },
    }).catch(() => null);
    return Boolean(existing);
}

export async function createPaymentRequestDm({
    paymentLinkId,
    receiverAddress,
}: {
    paymentLinkId: string;
    receiverAddress: string;
}) {
    const normalizedReceiver = receiverAddress.toLowerCase();
    const link = await prisma.paymentLink.findUnique({
        where: { id: paymentLinkId },
    });

    if (!link) {
        throw new Error("Payment link not found");
    }

    const unavailableReason = isPaymentLinkUnavailable(link);
    if (unavailableReason) {
        throw new Error(`Payment link is ${unavailableReason}`);
    }

    const creatorAddress = link.merchantAddress.toLowerCase();
    const creatorRole = await getAccountRole(creatorAddress);
    /* Links are created either by merchants (ENTERPRISE) or by users (peer-to-peer
       "receive USDC" links). Both open a request DM the recipient can act on. */
    if (creatorRole !== "ENTERPRISE" && creatorRole !== "USER") {
        throw new Error("This payment link's owner does not have a SubScript account.");
    }
    const isMerchantLink = creatorRole === "ENTERPRISE";
    const messageType = isMerchantLink ? "PAYMENT_REQUEST" : "PEER_REQUEST";

    if (creatorAddress === normalizedReceiver) {
        throw new Error("You can't pay your own payment link.");
    }

    const existing = await prisma.subscriptDm.findFirst({
        where: {
            receiverAddress: normalizedReceiver,
            paymentLinkId: link.id,
            messageType,
            status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
    });
    if (existing) return { dm: existing, created: false, link };

    const merchant = isMerchantLink
        ? await prisma.merchant.findUnique({
            where: { walletAddress: creatorAddress },
            select: { verified: true, profilePic: true },
        })
        : null;
    const creatorAlias = await prisma.addressAlias.findUnique({
        where: { address: creatorAddress },
    });

    const creatorName = link.merchantNameSnapshot || creatorAlias?.alias || `${creatorAddress.slice(0, 6)}...${creatorAddress.slice(-4)}`;
    const amount = formatUsdcFromMicros(link.amountUsdc);
    const issuedAt = new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    });

    const dm = await createDmAndNotify({
        senderAddress: creatorAddress,
        receiverAddress: normalizedReceiver,
        messageType,
        status: "PENDING",
        amountUsdc: link.amountUsdc,
        title: `${creatorName} requested ${amount} USDC`,
        description: [
            `Payment for: ${link.title}`,
            link.description ? `Details: ${link.description}` : null,
            `Amount: ${amount} USDC`,
            isMerchantLink
                ? `Merchant: ${creatorName}${merchant?.verified ? " (verified)" : " (unverified)"}`
                : `From: ${creatorName}`,
            `Issued: ${issuedAt}`,
            link.expiresAt ? `Expires: ${link.expiresAt.toLocaleString("en-US")}` : null,
        ].filter(Boolean).join("\n"),
        paymentLinkId: link.id,
    });

    return { dm, created: true, link };
}
