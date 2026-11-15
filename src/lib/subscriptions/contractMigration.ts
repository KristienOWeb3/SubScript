/*
 * Move live customer subscriptions from a legacy PSA to the active one.
 *
 * A PSA redeploy cannot move authorizations. They stay on the contract that minted them, and
 * keepers keep servicing them there while that contract is in LEGACY_SUBSCRIPTION_CONTRACTS. This
 * job re-creates each one on the active PSA, then retires the old one, so the legacy contract can
 * eventually be dropped.
 *
 * Per subscription, signed from the subscriber's custodial wallet:
 *   1. Create the replacement on the active PSA with the FIRST CHARGE DEFERRED to the old
 *      paid-through date (createSubscriptionWithDeferredFirstPayment). Nothing is charged today and
 *      the next charge lands exactly when the old one would have.
 *   2. Cancel the old authorization on the legacy PSA.
 *   3. If that cancel fails, cancel the replacement, so the subscriber never holds two chargeable
 *      authorizations. The two contracts can't be changed in one transaction, so this ordering is
 *      the safety property: create-then-cancel-with-rollback can only ever leave ONE live
 *      authorization, or (on a double failure) a reconciliation event for an operator.
 *   4. Mirror the new row (anchored to paid-through, carrying the unused value of the current
 *      window) and close the old one.
 *   5. Tell the merchant: subscription.updated with reason contract_migration and the previous id,
 *      so integrations keyed on the subscription id can follow it.
 *
 * Skipped, with a reason in the report (re-run the job later for the transient ones):
 *   - external (browser) wallets: only the subscriber can sign. They keep billing on the legacy
 *     contract, and cancel then resume moves them over.
 *   - inside an introductory promotion: the deferred create can't carry the remaining intro cycles,
 *     so moving now would bill the regular price early. They migrate once the promo has ended.
 *   - renewing within the safety window, already cancelled, or inactive on-chain.
 *
 * Idempotent per (legacy contract, subscription id): deterministic custody keys, and an already
 * migrated or closed row is skipped.
 */

import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { prisma } from "@/lib/prisma";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { activeSubscriptionContract, legacySubscriptionContracts, subscriptionKey } from "./contractBinding";
import { mirrorSubscriptionCreated } from "./mirror";
import {
    cancelFromEmbedded,
    getIntroductoryTermsOnChain,
    getSubscriptionOnChain,
    getSubscriptionPaidThrough,
    subscribeFromEmbedded,
    supportsDeferredSubscriptions,
} from "./onchain";
import { creditBasisForRow } from "./planChange";
import { unusedWindowValueMicros } from "./upgradeCheckout";
import { migrationEligibility, type MigrationSkipReason } from "./migrationEligibility";

export { MIGRATION_SAFETY_WINDOW_SECONDS, migrationEligibility } from "./migrationEligibility";
import { dispatchDurableSubscriptionWebhook } from "./webhookDelivery";

export type MigrationOutcome =
    | { subscriptionId: string; contract: string; action: "SKIPPED"; reason: MigrationSkipReason }
    | { subscriptionId: string; contract: string; action: "WOULD_MIGRATE"; firstChargeAt: string }
    | { subscriptionId: string; contract: string; action: "MIGRATED"; newSubscriptionId: string; firstChargeAt: string }
    | { subscriptionId: string; contract: string; action: "FAILED"; error: string; rolledBack?: boolean };

export type MigrationReport = {
    dryRun: boolean;
    activeContract: string;
    legacyContracts: string[];
    outcomes: MigrationOutcome[];
};

async function migrateOne(
    row: NonNullable<Awaited<ReturnType<typeof prisma.subscription.findFirst>>>,
    legacy: string,
    dryRun: boolean,
): Promise<MigrationOutcome> {
    const subscriptionId = String(row.subscriptionId);
    const subscriber = (row.subscriber || "").toLowerCase();
    const merchant = row.merchantAddress.toLowerCase();
    const base = { subscriptionId, contract: legacy };

    const onChain = await getSubscriptionOnChain(subscriptionId, legacy);
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const paidThroughSeconds = onChain ? await getSubscriptionPaidThrough(subscriptionId, onChain, legacy) : BigInt(0);
    const intro = onChain ? await getIntroductoryTermsOnChain(subscriptionId, legacy) : null;
    const custodial = isCustodialWallet(await getWalletCustody(subscriber));
    const eligibility = migrationEligibility({
        custodial,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        onChain,
        rowSubscriber: subscriber,
        paidThroughSeconds,
        nowSeconds,
        introCycles: intro?.introCycles ?? 0,
    });
    if (!eligibility.ok) return { ...base, action: "SKIPPED", reason: eligibility.reason };

    const firstChargeAt = new Date(Number(paidThroughSeconds) * 1000).toISOString();
    if (dryRun) return { ...base, action: "WOULD_MIGRATE", firstChargeAt };

    const amount = onChain!.amount;
    const period = onChain!.period;
    const carriedMicros = await creditBasisForRow(subscriptionId, onChain!, paidThroughSeconds, row)
        .then((basis) => unusedWindowValueMicros(basis, paidThroughSeconds, nowSeconds))
        .catch(() => BigInt(0));

    await requireSponsoredGas({ wallet: subscriber, action: "subscribe", requestKey: `contract-migration:${legacy}:${subscriptionId}` });

    /* 1. Replacement on the active PSA, nothing charged now. */
    const created = await subscribeFromEmbedded(
        subscriber,
        merchant,
        amount,
        period,
        deterministicIdempotencyKey(`contract-migration:create:${legacy}:${subscriptionId}`),
        null,
        { allowancePeriodSeconds: period, firstPaymentSeconds: paidThroughSeconds },
    );
    if (!created.subId) {
        await recordPaymentReconciliationRequired({
            dedupeKey: `contract-migration-id:${legacy}:${subscriptionId}`,
            kind: "SUBSCRIPTION_LOCAL_MIRROR",
            message: "contract migration created a replacement whose id could not be recovered; old authorization left live",
            context: { legacy, subscriptionId, subscriber, merchant, txHash: created.txHash },
        }).catch(() => {});
        return { ...base, action: "FAILED", error: "replacement id not recovered; old authorization left live" };
    }

    /* 2. Retire the old one. 3. Roll back the replacement if that fails. */
    let revocationTxHash: string;
    try {
        revocationTxHash = await cancelFromEmbedded(subscriber, subscriptionId, legacy);
    } catch (cancelError) {
        let rolledBack = false;
        try {
            await cancelFromEmbedded(subscriber, created.subId, activeSubscriptionContract());
            rolledBack = true;
        } catch (rollbackError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `contract-migration-rollback:${legacy}:${subscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "contract migration could not cancel the legacy authorization NOR roll back the replacement; two live authorizations",
                context: { legacy, subscriptionId, newSubscriptionId: created.subId, subscriber, merchant },
                error: rollbackError,
            }).catch(() => {});
        }
        return {
            ...base,
            action: "FAILED",
            error: cancelError instanceof Error ? cancelError.message : "legacy cancel failed",
            rolledBack,
        };
    }

    /* 4. Mirror the replacement first (it is the one that can move money), then close the old row. */
    const commitmentRemainingSeconds = row.minCommitmentUntil
        ? Math.max(0, Math.floor((row.minCommitmentUntil.getTime() - Date.now()) / 1000))
        : 0;
    try {
        await mirrorSubscriptionCreated({
            subscriptionId: created.subId,
            merchantAddress: merchant,
            subscriber,
            amountUsdc: amount,
            periodSeconds: period,
            beneficiaryAddress: row.beneficiaryAddress,
            minCommitmentSeconds: BigInt(commitmentRemainingSeconds),
            promotion: null,
            anchorNextPaymentSeconds: paidThroughSeconds,
            externalReference: row.externalReference,
            sourceCheckoutId: row.sourceCheckoutId,
            planId: row.planId,
            carriedCredit: { micros: carriedMicros, since: new Date() },
        });
        await prisma.subscription.update({
            where: subscriptionKey(row.subscriptionId, legacy),
            data: { status: "CANCELED", cancelAtPeriodEnd: false, revocationPending: false, revocationTxHash, updatedAt: new Date() },
        });
    } catch (mirrorError) {
        await recordPaymentReconciliationRequired({
            dedupeKey: `contract-migration-mirror:${legacy}:${subscriptionId}`,
            kind: "SUBSCRIPTION_LOCAL_MIRROR",
            message: "contract migration moved the authorization on-chain but the mirror rows were not updated",
            context: { legacy, subscriptionId, newSubscriptionId: created.subId, subscriber, merchant },
            error: mirrorError,
        }).catch(() => {});
        return { ...base, action: "FAILED", error: "on-chain move done; mirror update failed (reconciliation recorded)" };
    }

    /* 5. Merchant notice. Best-effort: the move is already durable. */
    await dispatchDurableSubscriptionWebhook(merchant, "subscription.updated", {
        ...subscriptionWebhookData({
            subscriptionId: created.subId,
            status: "active",
            amountUsdcMicros: amount,
            subscriber,
            merchantAddress: merchant,
            txHash: created.txHash,
            beneficiary: row.beneficiaryAddress,
            externalReference: row.externalReference,
            sourceCheckoutId: row.sourceCheckoutId,
            reason: "Moved to the updated subscription contract; terms and next charge date unchanged",
        }),
        plan_id: row.planId,
        planId: row.planId,
        previous_subscription_id: `sub_${subscriptionId}`,
        previousSubscriptionId: `sub_${subscriptionId}`,
        migration: "contract_migration",
        effective: "next_renewal",
        prorated_charge_usdc_micros: "0",
        proratedChargeUsdcMicros: "0",
        current_period_end: firstChargeAt,
        currentPeriodEnd: firstChargeAt,
    }, `customer-migrated:${legacy}:${subscriptionId}`).catch((webhookError: unknown) =>
        console.error("[contract-migration] merchant webhook enqueue failed:", webhookError));

    return { ...base, action: "MIGRATED", newSubscriptionId: created.subId, firstChargeAt };
}

/**
 * Migrate up to `limit` live customer subscriptions from every legacy contract. Dry run by
 * default: it reports what would move and why the rest would not, and signs nothing.
 */
export async function migrateLegacySubscriptions({ dryRun = true, limit = 25 }: { dryRun?: boolean; limit?: number } = {}): Promise<MigrationReport> {
    const legacyContracts = legacySubscriptionContracts();
    const report: MigrationReport = { dryRun, activeContract: activeSubscriptionContract(), legacyContracts, outcomes: [] };
    if (legacyContracts.length === 0) return report;
    if (!dryRun && !await supportsDeferredSubscriptions()) {
        throw new Error("The active subscription contract lacks deferred first payments; deploy PSA v3 before migrating.");
    }

    const rows = await prisma.subscription.findMany({
        where: { contractAddress: { in: legacyContracts }, kind: "CUSTOMER", status: "ACTIVE" },
        orderBy: { nextBillingDate: "desc" },
        take: Math.max(1, Math.min(limit, 200)),
    });
    for (const row of rows) {
        try {
            report.outcomes.push(await migrateOne(row, row.contractAddress.toLowerCase(), dryRun));
        } catch (error) {
            report.outcomes.push({
                subscriptionId: String(row.subscriptionId),
                contract: row.contractAddress,
                action: "FAILED",
                error: error instanceof Error ? error.message : "migration failed",
            });
        }
    }
    return report;
}
