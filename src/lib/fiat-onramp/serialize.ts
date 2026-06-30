import type { FiatFundingIntent } from "@prisma/client";

export function serializeFundingIntent(intent: FiatFundingIntent) {
    return {
        id: intent.id,
        status: intent.status,
        fiatCurrency: intent.fiatCurrency,
        fiatAmountMinor: intent.fiatAmountMinor.toString(),
        quoteRateNgnPerUsdcMinor: intent.quoteRateNgnPerUsdcMinor.toString(),
        grossUsdcMicros: intent.grossUsdcMicros.toString(),
        feeFiatMinor: intent.feeFiatMinor.toString(),
        netUsdcMicros: intent.netUsdcMicros.toString(),
        bankName: intent.bankName,
        accountName: intent.accountName,
        accountNumber: intent.accountNumber,
        transferReference: intent.transferReference,
        destinationWallet: intent.destinationWallet,
        destinationChainId: intent.destinationChainId,
        expiresAt: intent.expiresAt.toISOString(),
        settledAt: intent.settledAt?.toISOString() || null,
        settlementTxHash: intent.settlementTxHash,
        createdAt: intent.createdAt.toISOString(),
    };
}
