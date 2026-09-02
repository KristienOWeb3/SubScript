import { CCTP_CONFIG, SOLANA_CCTP_CONFIG, CCTPChainInfo } from "@/lib/contracts/constants";
import { BridgeDirection, BridgeFeeCalculation, BridgeRouteOption } from "./types";

/* Minimum bridge amounts:
   - Ethereum L1: 10 USDC ($10.00) to keep L1 gas efficiency reasonable.
   - L2s (Base, Arbitrum, OP, Polygon, Avalanche): 1 USDC ($1.00).
   Smaller deposits remain safely on-chain at the user's derived address until total balance >= minimum. */
export const MIN_BRIDGE_AMOUNT_L1_MICROS = 10_000_000n;
export const MIN_BRIDGE_AMOUNT_L2_MICROS = 1_000_000n;
export const MIN_BRIDGE_AMOUNT_MICROS = MIN_BRIDGE_AMOUNT_L2_MICROS;

export function getMinBridgeAmount(targetChainIdOrDomain: string | number): bigint {
  try {
    const chain = resolveBridgeChain(targetChainIdOrDomain);
    return chain.isL1 ? MIN_BRIDGE_AMOUNT_L1_MICROS : MIN_BRIDGE_AMOUNT_L2_MICROS;
  } catch {
    return MIN_BRIDGE_AMOUNT_L2_MICROS;
  }
}

/* CCTP V2 reverts above $10M per burn. Rejecting here gives the user a sentence instead of an
   unexplained on-chain revert. */
export const MAX_BRIDGE_AMOUNT_MICROS = 10_000_000_000_000n;

export const BPS_DIVISOR = 10_000n;

const isSolanaTarget = (target: string | number): boolean =>
  target === "solana" || target === SOLANA_CCTP_CONFIG.domain || target === String(SOLANA_CCTP_CONFIG.domain);

/* "1.0%" / "0.5%" / "0%", derived rather than switched on. A hardcoded ternary silently mislabels
   any tier that is not exactly 100 or 50 bps. */
export function formatFeeBps(feeBps: number): string {
  if (feeBps <= 0) return "0%";
  return `${(feeBps / 100).toFixed(1)}%`;
}

export function formatMicros(micros: bigint, decimals = 2): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, "0").slice(0, decimals);
  return decimals > 0 ? `${whole}.${frac}` : whole.toString();
}

/**
 * Resolves a chain id or CCTP domain to its config, or throws with a message worth showing a user.
 */
export function resolveBridgeChain(targetChainIdOrDomain: string | number): CCTPChainInfo {
  if (isSolanaTarget(targetChainIdOrDomain)) {
    throw new Error("Solana transfers aren't available yet.");
  }
  const chainId = Number(targetChainIdOrDomain);
  const chainConfig = Number.isFinite(chainId) ? CCTP_CONFIG[chainId] : undefined;
  if (!chainConfig) {
    throw new Error(`We don't support bridging to or from that network yet (${targetChainIdOrDomain}).`);
  }
  return chainConfig;
}

/**
 * Calculates the tiered protocol bridge fee.
 * - Ethereum L1 (ERC-20): 1.0% (100 bps)
 * - Every other CCTP EVM chain (Base, Arbitrum, OP, Polygon): 0.5% (50 bps)
 * - Arc itself: no fee. Arc transfers never reach this function.
 *
 * The fee is taken as a separate USDC transfer to the treasury *before* the CCTP burn, so
 * `netMicros` is the amount actually burned and therefore exactly what the destination mints. CCTP
 * mints 1:1, so a fee that is not split off before the burn is never collected at all.
 */
export function calculateBridgeFee(
  amountMicros: bigint | string | number,
  targetChainIdOrDomain: string | number,
  direction: BridgeDirection
): BridgeFeeCalculation {
  let grossMicros: bigint;
  try {
    grossMicros = BigInt(amountMicros.toString());
  } catch {
    throw new Error("That amount isn't a valid number.");
  }

  const chainConfig = resolveBridgeChain(targetChainIdOrDomain);
  const minRequired = chainConfig.isL1 ? MIN_BRIDGE_AMOUNT_L1_MICROS : MIN_BRIDGE_AMOUNT_L2_MICROS;

  if (grossMicros < minRequired) {
    throw new Error(`The smallest amount you can bridge on ${chainConfig.name} is ${formatMicros(minRequired)} USDC.`);
  }
  if (grossMicros > MAX_BRIDGE_AMOUNT_MICROS) {
    throw new Error(`The largest amount you can bridge in one go is ${formatMicros(MAX_BRIDGE_AMOUNT_MICROS, 0)} USDC.`);
  }

  if (direction === "inbound_deposit" && chainConfig.allowDeposits === false) {
    throw new Error(`Deposits from ${chainConfig.name} are turned off right now.`);
  }
  if (direction === "outbound_withdrawal" && chainConfig.allowWithdrawals === false) {
    throw new Error(`Withdrawals to ${chainConfig.name} are turned off right now.`);
  }

  const feeBps = chainConfig.feeBps;
  const feeMicros = (grossMicros * BigInt(feeBps)) / BPS_DIVISOR;
  const netMicros = grossMicros - feeMicros;

  /* Truncation favours the user, but a zero fee on a nonzero tier means the amount is small enough
     that the guard above should have caught it. Belt and braces: never let a priced transfer
     through for free. */
  if (feeBps > 0 && feeMicros <= 0n) {
    throw new Error("That amount is too small to bridge.");
  }
  if (netMicros <= 0n) {
    throw new Error("That amount is too small to bridge.");
  }

  return {
    grossMicros,
    feeMicros,
    netMicros,
    feeBps,
    feePercentage: formatFeeBps(feeBps),
    chainName: chainConfig.name,
    chainId: Object.keys(CCTP_CONFIG).find((id) => CCTP_CONFIG[Number(id)] === chainConfig) ?? "",
    domain: chainConfig.domain,
  };
}

/**
 * Validates a cross-chain transfer request and returns its fee split.
 */
export function validateBridgeRequest(params: {
  direction: BridgeDirection;
  targetChainIdOrDomain: string | number;
  amountMicros: bigint | string | number;
  userWallet: string;
  recipientAddress: string;
}): BridgeFeeCalculation {
  if (!params.userWallet || !/^0x[a-fA-F0-9]{40}$/.test(params.userWallet.trim())) {
    throw new Error("That sender wallet address doesn't look right.");
  }
  if (!params.recipientAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.recipientAddress.trim())) {
    throw new Error("That recipient address doesn't look right. Check it and try again.");
  }

  return calculateBridgeFee(params.amountMicros, params.targetChainIdOrDomain, params.direction);
}

/**
 * Every route the Send and Deposit pickers can offer, including the ones that are switched off, so
 * the UI can show them greyed out rather than pretending they don't exist. Arc is first because it
 * is the default and the only free route.
 */
export function listBridgeRoutes(direction: BridgeDirection): BridgeRouteOption[] {
  const arc: BridgeRouteOption = {
    id: "arc",
    name: "Arc",
    feeBps: 0,
    feePercentage: "0%",
    estimatedTime: "Instant",
    available: true,
  };

  const evm: BridgeRouteOption[] = Object.entries(CCTP_CONFIG)
    .map(([chainId, info]) => {
      const allowed = direction === "inbound_deposit" ? info.allowDeposits : info.allowWithdrawals;
      return {
        id: chainId,
        name: info.name,
        domain: info.domain,
        feeBps: info.feeBps,
        feePercentage: formatFeeBps(info.feeBps),
        /* Circle CCTP cross-chain attestation and relay */
        estimatedTime: "About 15 minutes",
        available: allowed !== false,
        nativeTokenSymbol: info.nativeTokenSymbol,
      };
    })
    /* L2s first, Ethereum last: cheaper and faster routes should be the easy pick. */
    .sort((a, b) => a.feeBps - b.feeBps || a.name.localeCompare(b.name));

  const solana: BridgeRouteOption = {
    id: "solana",
    name: SOLANA_CCTP_CONFIG.name,
    domain: SOLANA_CCTP_CONFIG.domain,
    feeBps: SOLANA_CCTP_CONFIG.feeBps,
    feePercentage: formatFeeBps(SOLANA_CCTP_CONFIG.feeBps),
    estimatedTime: "About 15 minutes",
    available: direction === "inbound_deposit" ? SOLANA_CCTP_CONFIG.allowDeposits : SOLANA_CCTP_CONFIG.allowWithdrawals,
    unavailableReason: "Coming soon",
    nativeTokenSymbol: SOLANA_CCTP_CONFIG.nativeTokenSymbol,
  };

  return [arc, ...evm, solana];
}
