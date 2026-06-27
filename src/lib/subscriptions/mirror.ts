/* Write-through mirror for customer (non-Premium) subscriptions.
   Customer subs live on-chain (created/modified/cancelled via the embedded-wallet routes and
   billed by on-chain Chainlink Automation). We mirror our own actions into the `subscriptions`
   table — kind "CUSTOMER" — so the dashboard can list them and detect an active plan for the
   switch UI. All functions are best-effort and never throw (callers already committed on-chain). */
import { prisma } from "@/lib/prisma";

export async function mirrorSubscriptionCreated({
    subscriptionId,
    merchantAddress,
    subscriber,
    amountUsdc,
    periodSeconds,
}: {
    subscriptionId: string | bigint;
    merchantAddress: string;
    subscriber: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
}) {
    try {
        const merchant = merchantAddress.toLowerCase();
        const sub = subscriber.toLowerCase();
        const id = BigInt(subscriptionId);
        const period = BigInt(periodSeconds);
        const now = new Date();
        const nextBilling = new Date(now.getTime() + Number(period) * 1000);

        /* The subscriptions.merchant_address FK requires a merchants row. */
        await prisma.merchant.upsert({
            where: { walletAddress: merchant },
            update: {},
            create: { walletAddress: merchant },
        });

        await prisma.subscription.upsert({
            where: { subscriptionId: id },
            update: {
                merchantAddress: merchant,
                subscriber: sub,
                status: "ACTIVE",
                kind: "CUSTOMER",
                amountCapUsdc: amountUsdc.toString(),
                billingIntervalSeconds: period,
                nextBillingDate: nextBilling,
                lastSettlementTimestamp: now,
                cancelAtPeriodEnd: false,
                updatedAt: now,
            },
            create: {
                subscriptionId: id,
                merchantAddress: merchant,
                subscriber: sub,
                status: "ACTIVE",
                tier: 0,
                kind: "CUSTOMER",
                amountCapUsdc: amountUsdc.toString(),
                billingIntervalSeconds: period,
                nextBillingDate: nextBilling,
                lastSettlementTimestamp: now,
            },
        });
    } catch (err) {
        console.error("[mirror] subscription create failed:", err instanceof Error ? err.message : err);
    }
}

export async function mirrorSubscriptionModified({
    subscriptionId,
    amountUsdc,
    periodSeconds,
}: {
    subscriptionId: string | bigint;
    amountUsdc: bigint;
    periodSeconds: bigint;
}) {
    try {
        await prisma.subscription.update({
            where: { subscriptionId: BigInt(subscriptionId) },
            data: {
                amountCapUsdc: amountUsdc.toString(),
                billingIntervalSeconds: BigInt(periodSeconds),
                kind: "CUSTOMER",
                updatedAt: new Date(),
            },
        });
    } catch (err) {
        /* Row may predate the mirror; that's fine — nothing to update. */
        console.error("[mirror] subscription modify skipped:", err instanceof Error ? err.message : err);
    }
}

export async function mirrorSubscriptionCanceled(subscriptionId: string | bigint) {
    try {
        await prisma.subscription.update({
            where: { subscriptionId: BigInt(subscriptionId) },
            data: { status: "CANCELED", updatedAt: new Date() },
        });
    } catch (err) {
        console.error("[mirror] subscription cancel skipped:", err instanceof Error ? err.message : err);
    }
}
