/* Explicitly publish a generic site subscription checkout as a DM-visible plan.
 *
 * Checkout sessions are attempts, not catalog entries. They can be assigned to one
 * subscriber, carry a beneficiary or invoice details, expire, or already be consumed.
 * Publication is therefore merchant-initiated and validates one checkout at a time.
 */
import { Prisma, type MerchantPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";

export const MAX_ACTIVE_MERCHANT_PLANS = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SitePlanPublicationError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
    }
}

export async function lockMerchantPlanCatalog(
    tx: Prisma.TransactionClient,
    merchantAddress: string,
) {
    await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
            hashtextextended(${`merchant-plan-catalog:${merchantAddress.toLowerCase()}`}, 0)
        )
    `;
}

function assertPublishableCheckout(
    link: {
        active: boolean;
        status: string;
        expiresAt: Date | null;
        useCount: number;
        paidAt: Date | null;
        verifiedTxHash: string | null;
        beneficiaryAddress: string | null;
        payerEmail: string | null;
        receiverAddress: string | null;
        receiverPrivateKey: string | null;
        invoiceNumber: string | null;
        dueDate: Date | null;
    },
    meta: NonNullable<ReturnType<typeof readSubscriptionCheckoutMeta>>,
    periodSeconds: bigint,
) {
    if (!link.active || link.status !== "PENDING") {
        throw new SitePlanPublicationError(
            "Only an active, pending subscription checkout can be published as a plan.",
            409,
            "CHECKOUT_NOT_PUBLISHABLE",
        );
    }
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
        throw new SitePlanPublicationError(
            "Expired subscription checkouts cannot be published as plans.",
            409,
            "CHECKOUT_EXPIRED",
        );
    }
    if (link.useCount !== 0 || link.paidAt || link.verifiedTxHash) {
        throw new SitePlanPublicationError(
            "A consumed subscription checkout cannot be published as a plan.",
            409,
            "CHECKOUT_CONSUMED",
        );
    }
    if (
        meta.subscriber
        || meta.beneficiary
        || link.beneficiaryAddress
        || link.payerEmail
        || link.receiverAddress
        || link.receiverPrivateKey
        || link.invoiceNumber
        || link.dueDate
    ) {
        throw new SitePlanPublicationError(
            "Customer-assigned, beneficiary-bound, or invoice-specific checkouts cannot be published as public plans.",
            409,
            "CHECKOUT_PRIVATE",
        );
    }
    if (BigInt(meta.minCommitmentSeconds) > periodSeconds) {
        throw new SitePlanPublicationError(
            "The checkout minimum commitment exceeds its billing period.",
            409,
            "CHECKOUT_INVALID_COMMITMENT",
        );
    }
}

export async function publishSitePlanFromCheckout(
    merchantAddress: string,
    checkoutSessionId: string,
): Promise<{ plan: MerchantPlan; created: boolean }> {
    const merchant = merchantAddress.toLowerCase();
    const checkoutId = checkoutSessionId.trim().toLowerCase();
    if (!UUID_PATTERN.test(checkoutId)) {
        throw new SitePlanPublicationError("checkoutSessionId must be a valid UUID.", 400, "INVALID_CHECKOUT_ID");
    }

    return prisma.$transaction(async (tx) => {
        await lockMerchantPlanCatalog(tx, merchant);

        /* The persisted source identity makes retries idempotent. Do not reactivate an
           existing plan: a merchant's later deactivation remains authoritative. */
        const existingPublishedPlan = await tx.merchantPlan.findUnique({
            where: { sourceCheckoutId: checkoutId },
        });
        if (existingPublishedPlan) {
            if (existingPublishedPlan.merchantAddress.toLowerCase() !== merchant) {
                throw new SitePlanPublicationError("Checkout source is already owned by another merchant.", 409, "SOURCE_CONFLICT");
            }
            return { plan: existingPublishedPlan, created: false };
        }

        /* Lock the attempt while eligibility is checked so a concurrent cancel/finalize
           cannot change it between validation and plan creation. */
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
              FROM payment_links
             WHERE id = ${checkoutId}::uuid
             FOR UPDATE
        `;
        if (locked.length === 0) {
            throw new SitePlanPublicationError("Subscription checkout not found.", 404, "CHECKOUT_NOT_FOUND");
        }

        const link = await tx.paymentLink.findUnique({ where: { id: checkoutId } });
        if (!link || link.merchantAddress.toLowerCase() !== merchant) {
            throw new SitePlanPublicationError("Subscription checkout not found.", 404, "CHECKOUT_NOT_FOUND");
        }
        const meta = readSubscriptionCheckoutMeta(link.stateSnapshot);
        if (!meta) {
            throw new SitePlanPublicationError("Checkout is not a subscription checkout.", 400, "NOT_SUBSCRIPTION_CHECKOUT");
        }

        /* A checkout created from an existing plan already carries the canonical plan id.
           Return that exact row instead of manufacturing another identity. */
        if (meta.planId) {
            const canonicalPlan = await tx.merchantPlan.findFirst({
                where: { id: meta.planId, merchantAddress: merchant },
            });
            if (!canonicalPlan) {
                throw new SitePlanPublicationError(
                    "Checkout references a plan that no longer exists.",
                    409,
                    "CANONICAL_PLAN_MISSING",
                );
            }
            return { plan: canonicalPlan, created: false };
        }

        const periodSeconds = subscriptionCheckoutPeriod(meta);
        assertPublishableCheckout(link, meta, periodSeconds);

        const activeCount = await tx.merchantPlan.count({
            where: { merchantAddress: merchant, active: true },
        });
        if (activeCount >= MAX_ACTIVE_MERCHANT_PLANS) {
            throw new SitePlanPublicationError(
                `You can have at most ${MAX_ACTIVE_MERCHANT_PLANS} active plans.`,
                403,
                "PLAN_LIMIT_REACHED",
            );
        }

        const plan = await tx.merchantPlan.create({
            data: {
                merchantAddress: merchant,
                name: link.title.trim().slice(0, 60) || "Subscription",
                description: link.description?.trim().slice(0, 300) || null,
                amountUsdc: link.amountUsdc,
                periodSeconds,
                minCommitmentSeconds: BigInt(meta.minCommitmentSeconds),
                sourceCheckoutId: checkoutId,
            },
        });
        return { plan, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
