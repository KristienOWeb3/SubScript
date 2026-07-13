import { prisma } from "@/lib/prisma";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import {
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
} from "@/lib/subscriptions/onchain";

export type RetryablePaymentReconciliationEvent = {
    id: string;
    kind: string;
    context: Record<string, unknown>;
};

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredString(context: Record<string, unknown>, key: string) {
    const value = context[key];
    if (typeof value !== "string" || !value) {
        throw new Error(`Reconciliation context is missing ${key}`);
    }
    return value;
}

function requiredAddress(context: Record<string, unknown>, key: string) {
    const value = requiredString(context, key).toLowerCase();
    if (!ADDRESS_PATTERN.test(value)) throw new Error(`Reconciliation context has an invalid ${key}`);
    return value;
}

function requiredPositiveBigInt(context: Record<string, unknown>, key: string) {
    const value = requiredString(context, key);
    if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
        throw new Error(`Reconciliation context has an invalid ${key}`);
    }
    return BigInt(value);
}

function optionalNonNegativeBigInt(context: Record<string, unknown>, key: string) {
    const value = context[key];
    if (value === null || value === undefined || value === "") return BigInt(0);
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error(`Reconciliation context has an invalid ${key}`);
    }
    return BigInt(value);
}

async function retryEmbeddedIdempotencyCompletion(context: Record<string, unknown>) {
    const claimKey = requiredString(context, "claimKey");
    const txHash = requiredString(context, "txHash").toLowerCase();
    if (!TX_HASH_PATTERN.test(txHash)) throw new Error("Reconciliation context has an invalid txHash");

    const claim = await prisma.idempotencyKey.findUnique({ where: { executionKey: claimKey } });
    if (!claim) throw new Error("Embedded payment idempotency claim no longer exists");
    if (claim.status === "COMPLETED") return;

    await prisma.idempotencyKey.update({
        where: { executionKey: claimKey },
        data: { status: "COMPLETED", responsePayload: { txHash } },
    });
}

async function retrySubscriptionReconciliation(context: Record<string, unknown>) {
    const subscriber = requiredAddress(context, "subscriber");
    const merchant = requiredAddress(context, "merchant");
    const expectedAmount = requiredPositiveBigInt(context, "amountUsdc");
    const expectedPeriod = requiredPositiveBigInt(context, "periodSeconds");
    const minCommitmentSeconds = optionalNonNegativeBigInt(context, "minCommitmentSeconds");
    const beneficiaryValue = context.beneficiaryAddress;
    const beneficiaryAddress = beneficiaryValue === null || beneficiaryValue === undefined || beneficiaryValue === ""
        ? null
        : requiredAddress(context, "beneficiaryAddress");

    const contextSubscriptionId = typeof context.subscriptionId === "string" && /^\d+$/.test(context.subscriptionId)
        ? context.subscriptionId
        : null;
    const subscriptionId = contextSubscriptionId
        || await findActiveOnChainSubscriptionId(subscriber, merchant);
    if (!subscriptionId) throw new Error("No active on-chain subscription is discoverable yet");

    const onChain = await getSubscriptionOnChain(subscriptionId);
    if (
        !onChain?.isActive
        || onChain.subscriber !== subscriber
        || onChain.merchant !== merchant
        || onChain.amount !== expectedAmount
        || onChain.period !== expectedPeriod
    ) {
        throw new Error("On-chain subscription does not match the recorded checkout terms");
    }

    await mirrorSubscriptionCreated({
        subscriptionId,
        merchantAddress: merchant,
        subscriber,
        amountUsdc: onChain.amount,
        periodSeconds: onChain.period,
        beneficiaryAddress,
        minCommitmentSeconds,
    });

    const checkoutSessionId = context.checkoutSessionId;
    if (typeof checkoutSessionId === "string" && checkoutSessionId) {
        if (!UUID_PATTERN.test(checkoutSessionId)) {
            throw new Error("Reconciliation context has an invalid checkoutSessionId");
        }
        const txHash = typeof context.txHash === "string" && TX_HASH_PATTERN.test(context.txHash)
            ? context.txHash.toLowerCase()
            : undefined;
        const updated = await prisma.paymentLink.updateMany({
            where: { id: checkoutSessionId },
            data: {
                active: false,
                status: "PAID",
                paidAt: new Date(),
                ...(txHash ? { verifiedTxHash: txHash } : {}),
            },
        });
        if (updated.count !== 1) throw new Error("Subscription checkout no longer exists");
    }
}

/** Executes the real, idempotent repair behind the admin retry action. */
export async function retryPaymentReconciliationEvent(event: RetryablePaymentReconciliationEvent) {
    if (event.kind === "EMBEDDED_PAYMENT_IDEMPOTENCY_COMPLETION") {
        await retryEmbeddedIdempotencyCompletion(event.context);
        return;
    }
    if (event.kind.startsWith("SUBSCRIPTION_")) {
        await retrySubscriptionReconciliation(event.context);
        return;
    }
    throw new Error(`No automatic reconciliation handler exists for ${event.kind}`);
}
