import { ethers } from "ethers";
import { CCTP_CONFIG, ARC_CCTP_DOMAIN_ID } from "@/lib/contracts/constants";
import { resolveRpcUrl } from "./relayer";
import { ERC20_ABI } from "./circleBridge";
import { notifyDepositStarted } from "./notifications";
import { pgQuery, pgMaybeOne } from "@/lib/serverPg";
import { processPendingCctpTransfers } from "./attestationWorker";
import { calculateBridgeFee, formatMicros } from "./feeEngine";

export interface ChainBalanceResult {
  chainId: number;
  chainName: string;
  nativeTokenSymbol: string;
  usdcAddress: string;
  balanceMicros: string;
  balanceUsdc: string;
  domain: number;
  feeBps: number;
  hasBalance: boolean;
}

export interface CrossChainScanResult {
  wallet: string;
  scannedAt: number;
  balances: ChainBalanceResult[];
  totalCrossChainUsdc: string;
  activeInboundTransfers: any[];
}

/**
 * Queries the USDC balance for a given address across all active CCTP chains in parallel.
 */
export async function scanCrossChainBalances(walletAddress: string): Promise<CrossChainScanResult> {
  const normalizedWallet = walletAddress.toLowerCase();
  const chainEntries = Object.entries(CCTP_CONFIG);

  const balancePromises = chainEntries.map(async ([chainIdStr, config]): Promise<ChainBalanceResult> => {
    const chainId = Number(chainIdStr);
    const rpc = resolveRpcUrl(chainId);

    if (!rpc || !config.usdc) {
      return {
        chainId,
        chainName: config.name,
        nativeTokenSymbol: config.nativeTokenSymbol,
        usdcAddress: config.usdc,
        balanceMicros: "0",
        balanceUsdc: "0.00",
        domain: config.domain,
        feeBps: config.feeBps,
        hasBalance: false,
      };
    }

    try {
      const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      const usdcContract = new ethers.Contract(config.usdc, ERC20_ABI, provider);

      // Timeout individual chain query at 4.5 seconds to prevent hanging
      const balanceBigInt: bigint = await Promise.race([
        usdcContract.balanceOf(normalizedWallet),
        new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 4500)),
      ]);

      const balanceMicros = balanceBigInt.toString();
      const balanceUsdc = formatMicros(balanceBigInt);
      const hasBalance = balanceBigInt > 0n;

      return {
        chainId,
        chainName: config.name,
        nativeTokenSymbol: config.nativeTokenSymbol,
        usdcAddress: config.usdc,
        balanceMicros,
        balanceUsdc,
        domain: config.domain,
        feeBps: config.feeBps,
        hasBalance,
      };
    } catch {
      return {
        chainId,
        chainName: config.name,
        nativeTokenSymbol: config.nativeTokenSymbol,
        usdcAddress: config.usdc,
        balanceMicros: "0",
        balanceUsdc: "0.00",
        domain: config.domain,
        feeBps: config.feeBps,
        hasBalance: false,
      };
    }
  });

  const balances = await Promise.all(balancePromises);

  // Calculate total cross-chain USDC
  let totalMicros = 0n;
  for (const b of balances) {
    try {
      totalMicros += BigInt(b.balanceMicros);
    } catch {
      // ignore
    }
  }

  // Look for any active in-flight CCTP transfers for this wallet
  const activeTransfers = await pgQuery<any>(
    `SELECT id, direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
            destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
            net_amount_micros, burn_tx_hash, mint_tx_hash, status, created_at
       FROM cctp_bridge_transfers
      WHERE (user_wallet = $1 OR recipient_address = $1)
        AND status IN ('pending_attestation', 'minting')
      ORDER BY created_at DESC
      LIMIT 10`,
    [normalizedWallet]
  ).catch(() => []);

  // Trigger background attestation processing if there are in-flight transfers
  if (activeTransfers.length > 0) {
    void processPendingCctpTransfers().catch(() => undefined);
  }

  return {
    wallet: normalizedWallet,
    scannedAt: Date.now(),
    balances,
    totalCrossChainUsdc: formatMicros(totalMicros),
    activeInboundTransfers: activeTransfers,
  };
}

/**
 * Detects new inbound USDC deposits across CCTP chains and registers notifications.
 */
export async function detectAndNotifyInboundCctp(
  walletAddress: string,
  originChainId: number,
  burnTxHash: string,
  grossAmountMicros: string
): Promise<void> {
  const normalizedWallet = walletAddress.toLowerCase();
  const config = CCTP_CONFIG[originChainId];
  if (!config) return;

  const existing = await pgMaybeOne<{ id: string }>(
    `SELECT id FROM cctp_bridge_transfers WHERE burn_tx_hash = $1 LIMIT 1`,
    [burnTxHash]
  );

  if (!existing) {
    const feeInfo = calculateBridgeFee(grossAmountMicros, originChainId, "inbound_deposit");
    await pgQuery(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, burn_tx_hash, status)
       VALUES ('inbound_deposit', $1, $1, $2, $3, 'arc', $4, $5, $6, $7, $8, $9, 'pending_attestation')
       ON CONFLICT (burn_tx_hash) DO NOTHING`,
      [
        normalizedWallet,
        String(originChainId),
        config.domain,
        ARC_CCTP_DOMAIN_ID,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
        burnTxHash,
      ]
    ).catch(() => undefined);
  }

  await notifyDepositStarted({
    recipientAddress: normalizedWallet,
    originChainName: config.name,
  });

  void processPendingCctpTransfers().catch(() => undefined);
}
