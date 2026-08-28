export type BridgeDirection = "inbound_deposit" | "outbound_withdrawal";

/* pending_burn   — row exists, nothing irreversible has happened yet.
   pending_fee    — the fee transfer is in flight or done; the burn has not been submitted.
   pending_attestation — USDC is burned. Circle has not signed the message yet.
   minting        — attestation in hand, relaying to the destination.
   completed      — destination minted.
   failed         — terminal. Needs a human; the keeper has stopped retrying. */
export type BridgeTransferStatus =
  | "pending_burn"
  | "pending_fee"
  | "pending_attestation"
  | "minting"
  | "completed"
  | "failed";

export interface BridgeTransferRecord {
  id: string;
  direction: BridgeDirection;
  userWallet: string;
  recipientAddress: string;
  originChainId: string;
  originDomain: number;
  destinationChainId: string;
  destinationDomain: number;
  grossAmountMicros: string;
  feeAmountMicros: string;
  netAmountMicros: string;
  feeBps: number;
  feeTxHash: string | null;
  burnTxHash: string | null;
  messageBytes: string | null;
  messageHash: string | null;
  attestationBytes: string | null;
  mintTxHash: string | null;
  status: BridgeTransferStatus;
  attemptCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BridgeFeeCalculation {
  /* What the user asked to move. */
  grossMicros: bigint;
  /* Skimmed to the treasury before the burn. */
  feeMicros: bigint;
  /* Burned, and therefore exactly what the destination mints. */
  netMicros: bigint;
  feeBps: number;
  feePercentage: string;
  chainName: string;
  chainId: string;
  domain: number;
}

/* One entry per network the Send or Deposit picker can list, switched-off ones included. */
export interface BridgeRouteOption {
  /* "arc", "solana", or a chain id as a string. */
  id: string;
  name: string;
  domain?: number;
  feeBps: number;
  feePercentage: string;
  estimatedTime: string;
  available: boolean;
  unavailableReason?: string;
  nativeTokenSymbol?: string;
}

export interface RelayerBalanceInfo {
  chainId: string;
  chainName: string;
  nativeTokenSymbol: string;
  walletAddress: string;
  nativeBalance: string;
  formattedBalance: string;
  status: "healthy" | "warning" | "critical";
  error?: string;
}
