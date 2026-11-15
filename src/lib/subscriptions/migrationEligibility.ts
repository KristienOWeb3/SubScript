/*
 * Which legacy-contract subscriptions the contract migration may move right now. Pure: no chain,
 * database or clock of its own, so it is testable in isolation. See contractMigration.ts.
 */

import type { OnChainSubscription } from "./onchain";
import { currentSequenceFor } from "./upgradeCheckout";

/* Never move a subscription this close to its next charge: the keeper could be charging the old
   authorization while the job cancels it. */
export const MIGRATION_SAFETY_WINDOW_SECONDS = BigInt(60 * 60);

export type MigrationSkipReason =
    | "EXTERNAL_WALLET"
    | "IN_PROMOTION"
    | "RENEWS_TOO_SOON"
    | "CANCEL_SCHEDULED"
    | "INACTIVE_ON_CHAIN"
    | "CHAIN_READ_FAILED"
    | "NOT_OWNED";

/**
 * Pure eligibility rule, exported for tests. Decides whether a legacy subscription can be moved
 * right now, given what the chain and the custody lookup said.
 */
export function migrationEligibility(input: {
    custodial: boolean;
    cancelAtPeriodEnd: boolean;
    onChain: Pick<OnChainSubscription, "isActive" | "subscriber" | "nextPayment" | "period"> | null;
    rowSubscriber: string;
    paidThroughSeconds: bigint;
    nowSeconds: bigint;
    introCycles: number;
}): { ok: true } | { ok: false; reason: MigrationSkipReason } {
    if (!input.onChain) return { ok: false, reason: "CHAIN_READ_FAILED" };
    if (input.onChain.subscriber !== input.rowSubscriber.toLowerCase()) return { ok: false, reason: "NOT_OWNED" };
    if (input.cancelAtPeriodEnd) return { ok: false, reason: "CANCEL_SCHEDULED" };
    if (!input.onChain.isActive) return { ok: false, reason: "INACTIVE_ON_CHAIN" };
    if (input.paidThroughSeconds - input.nowSeconds < MIGRATION_SAFETY_WINDOW_SECONDS) {
        return { ok: false, reason: "RENEWS_TOO_SOON" };
    }
    /* The next charge is sequence (current + 1). While that is still an introductory sequence the
       subscriber is owed the promo price, which the deferred create cannot express. */
    const current = currentSequenceFor(input.onChain.nextPayment, input.paidThroughSeconds, input.onChain.period);
    if (input.introCycles > 0 && current + BigInt(1) < BigInt(input.introCycles)) {
        return { ok: false, reason: "IN_PROMOTION" };
    }
    if (!input.custodial) return { ok: false, reason: "EXTERNAL_WALLET" };
    return { ok: true };
}

