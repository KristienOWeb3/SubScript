/** Only financial fields are bound: the upgrade itself revokes the old chain authorization. */
export function subscriptionUpgradeSnapshot(resolved: {
    current: { subscriptionId: bigint; contractAddress: string; beneficiaryAddress: string | null; minCommitmentUntil: Date | null; planId: string | null; sourceCheckoutId: string | null };
    target: { id: string; merchantAddress: string; amountUsdc: bigint; periodSeconds: bigint };
    onChain: { subscriber: string; merchant: string; amount: bigint; period: bigint; nextPayment: bigint };
    terms: { dueTodayMicros: bigint; unusedCreditMicros: bigint; useIntroductoryTerms: boolean };
}, quotedAt: Date) {
    return {
        quotedAt: quotedAt.toISOString(),
        subscriptionId: resolved.current.subscriptionId.toString(),
        contractAddress: resolved.current.contractAddress,
        beneficiaryAddress: resolved.current.beneficiaryAddress,
        minCommitmentUntil: resolved.current.minCommitmentUntil,
        planId: resolved.current.planId,
        sourceCheckoutId: resolved.current.sourceCheckoutId,
        target: { id: resolved.target.id, merchant: resolved.target.merchantAddress, amount: resolved.target.amountUsdc.toString(), period: resolved.target.periodSeconds.toString() },
        previous: { subscriber: resolved.onChain.subscriber, merchant: resolved.onChain.merchant, amount: resolved.onChain.amount.toString(), period: resolved.onChain.period.toString(), nextPayment: resolved.onChain.nextPayment.toString() },
        charge: resolved.terms.dueTodayMicros.toString(),
        credit: resolved.terms.unusedCreditMicros.toString(),
        introductory: resolved.terms.useIntroductoryTerms,
    };
}
