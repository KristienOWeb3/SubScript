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
    beneficiaryAddress,
    minCommitmentSeconds,
}: {
    subscriptionId: string | bigint;
    merchantAddress: string;
    subscriber: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    /* Sponsored subscriptions: the wallet that receives the service when it differs
       from the paying subscriber. Carried into merchant webhooks. */
    beneficiaryAddress?: string | null;
    /* Plan commitment window snapshot (<= one period). NULL/0 = no commitment. */
    minCommitmentSeconds?: bigint | null;
}) {
    try {
        const merchant = merchantAddress.toLowerCase();
        const sub = subscriber.toLowerCase();
        const id = BigInt(subscriptionId);
        const period = BigInt(periodSeconds);
        const now = new Date();
        const nextBilling = new Date(now.getTime() + Number(period) * 1000);
        const beneficiary = beneficiaryAddress ? beneficiaryAddress.toLowerCase() : null;
        const commitmentUntil = minCommitmentSeconds && minCommitmentSeconds > BigInt(0)
            ? new Date(now.getTime() + Number(minCommitmentSeconds) * 1000)
            : null;

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
                beneficiaryAddress: beneficiary,
                minCommitmentUntil: commitmentUntil,
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
                beneficiaryAddress: beneficiary,
                minCommitmentUntil: commitmentUntil,
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

/* Flag a customer subscription to cancel at the end of its already-paid period: stop future
   billing now but keep it ACTIVE until `nextPaymentSeconds` (the paid-through date). The
   customer-billing keeper performs the actual on-chain cancel once next_billing_date is reached.
   Upserts so a sub created before the mirror still gets a row the keeper can find. */
/* Returns true only if the cancel-at-period-end marker was persisted. Callers that treat this row
   as the authoritative record of the cancellation (e.g. the sponsorship-unavailable fallback in the
   cancel route) must check the result and NOT report success to the user on a false return. */
export async function mirrorSubscriptionCancelAtPeriodEnd({
    subscriptionId,
    merchantAddress,
    subscriber,
    amountUsdc,
    periodSeconds,
    nextPaymentSeconds,
}: {
    subscriptionId: string | bigint;
    merchantAddress: string;
    subscriber: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    nextPaymentSeconds: bigint;
}): Promise<boolean> {
    try {
        const merchant = merchantAddress.toLowerCase();
        const sub = subscriber.toLowerCase();
        const id = BigInt(subscriptionId);
        const now = new Date();
        const nextBilling = new Date(Number(nextPaymentSeconds) * 1000);
        /* The DB trigger derives next_billing_date from last_settlement_timestamp + interval, so
           anchor last settlement to the period start (nextPayment - period) to land next_billing
           exactly on the paid-through date. next_billing_date is also set explicitly for robustness. */
        const periodStart = new Date(Number(nextPaymentSeconds - periodSeconds) * 1000);

        await prisma.merchant.upsert({
            where: { walletAddress: merchant },
            update: {},
            create: { walletAddress: merchant },
        });
        await prisma.subscription.upsert({
            where: { subscriptionId: id },
            update: {
                status: "ACTIVE",
                kind: "CUSTOMER",
                cancelAtPeriodEnd: true,
                cancelRequestedAt: now,
                lastSettlementTimestamp: periodStart,
                nextBillingDate: nextBilling,
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
                billingIntervalSeconds: periodSeconds,
                lastSettlementTimestamp: periodStart,
                nextBillingDate: nextBilling,
                cancelAtPeriodEnd: true,
                cancelRequestedAt: now,
            },
        });
        return true;
    } catch (err) {
        console.error("[mirror] cancel-at-period-end skipped:", err instanceof Error ? err.message : err);
        return false;
    }
}
