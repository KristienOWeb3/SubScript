/*
 * Shared pricing for plan changes (upgrade, downgrade, interval switch) and resume.
 *
 * Every path that replaces one authorization with another has to agree on one number: how much
 * paid-for value is still unused in the window the subscriber is in now. That value is:
 *   - an upgrade's credit
 *   - what a downgrade or resume carries into the new authorization's free deferred window, so a
 *     later upgrade credits it correctly
 * It is always priced on value actually paid (see CreditBasis), never on the list price.
 */

import type { OnChainSubscription } from "./onchain";
import { readChargeAmountFor } from "./onchain";
import { creditBasisFor, currentSequenceFor, type CreditBasis } from "./upgradeCheckout";

export { unusedWindowValueMicros } from "./upgradeCheckout";

/** The mirror row's carried-in value, normalised for readCreditBasis. */
export function carriedFromRow(row: { carriedCreditUsdcMicros?: bigint | number | null; carriedCreditSince?: Date | null }) {
    return {
        micros: BigInt(row.carriedCreditUsdcMicros ?? 0),
        since: row.carriedCreditSince ?? null,
    };
}

/** Credit basis for the subscription a row mirrors, read from the chain plus the row. */
export async function creditBasisForRow(
    subscriptionId: string | bigint,
    onChain: OnChainSubscription,
    paidThroughSeconds: bigint,
    row: { carriedCreditUsdcMicros?: bigint | number | null; carriedCreditSince?: Date | null },
): Promise<CreditBasis> {
    const carried = carriedFromRow(row);
    const sequence = currentSequenceFor(onChain.nextPayment, paidThroughSeconds, onChain.period);
    const charged = await readChargeAmountFor(subscriptionId, sequence, onChain.amount);
    return creditBasisFor({
        sequence,
        sequenceChargeMicros: charged,
        carriedCreditMicros: carried.micros,
        carriedCreditSinceSeconds: carried.since ? BigInt(Math.floor(carried.since.getTime() / 1000)) : null,
        nextPaymentSeconds: onChain.nextPayment,
        paidThroughSeconds,
        periodSeconds: onChain.period,
    });
}
