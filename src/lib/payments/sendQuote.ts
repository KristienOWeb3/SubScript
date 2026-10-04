/** Human-readable USDC values, kept as decimal strings until presentation. */
export type SendQuote = {
  amountUsdc: string;
  feeUsdc: string;
  recipientUsdc: string;
  totalDebitUsdc: string;
  feeTreatment: "additional" | "deducted";
  feeLabel: string;
  arrival: string;
  estimated: boolean;
  nativeGasUsdc?: string;
  gasPaidByWallet?: boolean;
};

export type SendQuoteRequest = {
  amount: string;
  networkId: string;
  recipientAddress?: string;
};

export type SendResult = SendQuote & {
  txHash: string;
  recipientAddress: string;
  networkId: string;
  status: "confirmed" | "pending_attestation" | "pending" | "failed";
  explorerUrl: string;
  transferId?: string;
  circleTxId?: string;
  operationId?: string;
  feeUnrecovered?: boolean;
};

export function usdcToMicros(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a USDC amount with at most six decimal places.");
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] || "").padEnd(6, "0"));
}

export function microsToUsdc(value: bigint): string {
  if (value < 0n) throw new Error("USDC amounts cannot be negative.");
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

/** Reserve every fraction of a micro, so Max never overcommits native USDC gas. */
export function nativeGasToMicros(gasUsed: bigint, gasPrice: bigint): bigint {
  if (gasUsed < 0n || gasPrice < 0n) throw new Error("Invalid network gas data.");
  const weiPerMicro = 1_000_000_000_000n;
  return (gasUsed * gasPrice + weiPerMicro - 1n) / weiPerMicro;
}

export function createSendQuote(input: {
  amountUsdc: string;
  feeUsdc: string;
  feeTreatment: SendQuote["feeTreatment"];
  feeLabel: string;
  arrival: string;
  estimated: boolean;
  nativeGasUsdc?: string;
  gasPaidByWallet?: boolean;
}): SendQuote {
  const amount = usdcToMicros(input.amountUsdc);
  const fee = usdcToMicros(input.feeUsdc);
  const nativeGas = usdcToMicros(input.nativeGasUsdc || "0");
  if (input.feeTreatment === "deducted" && fee > amount) throw new Error("The fee exceeds the send amount.");
  return {
    ...input,
    amountUsdc: microsToUsdc(amount),
    feeUsdc: microsToUsdc(fee),
    recipientUsdc: microsToUsdc(input.feeTreatment === "deducted" ? amount - fee : amount),
    totalDebitUsdc: microsToUsdc(amount + (input.feeTreatment === "additional" ? fee : 0n) + nativeGas),
  };
}

export function quoteEmbeddedArcReceipt(amountUsdc: string, networkFee?: {
  amountUsdc: string;
  charged: boolean;
  unrecovered?: boolean;
}): SendQuote {
  // A quoted recovery fee is not a debit until the server reports it charged. The fee is now
  // recovered in the background (so the send returns after one confirmation instead of two), so the
  // receipt shows the quoted amount marked as an estimate until the charge confirms. Only a fee that
  // genuinely could not be recovered shows as 0.
  if (!networkFee) throw new Error("The transfer receipt is missing its network fee result.");
  return createSendQuote({
    amountUsdc,
    feeUsdc: networkFee.unrecovered ? "0" : networkFee.amountUsdc,
    feeTreatment: "additional",
    feeLabel: "Network fee",
    arrival: "Confirmed on Arc",
    estimated: !networkFee.charged,
  });
}

export function maxSendAmount(balanceUsdc: string, quote: SendQuote): string {
  const reservedFee = (quote.feeTreatment === "additional" ? usdcToMicros(quote.feeUsdc) : 0n)
    + usdcToMicros(quote.nativeGasUsdc || "0");
  const remaining = usdcToMicros(balanceUsdc) - reservedFee;
  return microsToUsdc(remaining > 0n ? remaining : 0n);
}
