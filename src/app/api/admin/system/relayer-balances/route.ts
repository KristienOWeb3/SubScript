import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { requireScope } from "@/lib/admin/guard";
import { CCTP_CONFIG, isProd } from "@/lib/contracts/constants";
import { getArcRpcUrl, getRelayerAddress, resolveRpcUrl } from "@/lib/cctp/relayer";
import { getSolanaConnection, getSolanaRelayerAddress } from "@/lib/cctp/solanaRelayer";
import type { RelayerBalanceInfo } from "@/lib/cctp/types";

export const maxDuration = 60;

/* Native gas thresholds per chain, in whole tokens. Polygon is denominated in POL, Solana in SOL,
   everything else in ETH, which is why they cannot share one number. */
const THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  arc: { warning: 10, critical: 2 },
  "1": { warning: 0.1, critical: 0.02 },
  "137": { warning: 10, critical: 2 },
  solana: { warning: 0.2, critical: 0.05 },
  default: { warning: 0.05, critical: 0.01 },
};

function statusFor(chainKey: string, balance: number): RelayerBalanceInfo["status"] {
  const { warning, critical } = THRESHOLDS[chainKey] ?? THRESHOLDS.default;
  if (balance > warning) return "healthy";
  if (balance > critical) return "warning";
  return "critical";
}

/**
 * Native gas balances for every chain the CCTP relayer mints on.
 *
 * The address comes from lib/cctp/relayer, the same helper the attestation worker signs with. When
 * this route derived its own address from SPONSOR_PRIVATE_KEY it reported a healthy balance for a
 * wallet that was not the one paying for mints.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, "engineering");
  if (!auth.ok) return auth.response;

  const relayerAddress = getRelayerAddress();
  if (!relayerAddress) {
    return NextResponse.json(
      {
        error: "No relayer key or address configured. Set RELAYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY).",
      },
      { status: 503 },
    );
  }

  const balances: RelayerBalanceInfo[] = [];

  const readNative = async (params: {
    chainKey: string;
    rpc: string | null;
    chainName: string;
    symbol: string;
  }): Promise<RelayerBalanceInfo> => {
    const base = {
      chainId: params.chainKey,
      chainName: params.chainName,
      nativeTokenSymbol: params.symbol,
      walletAddress: relayerAddress,
    };
    if (!params.rpc) {
      return { ...base, nativeBalance: "0", formattedBalance: "0.0000", status: "critical", error: "No RPC configured" };
    }
    try {
      const provider = new ethers.JsonRpcProvider(params.rpc, undefined, { staticNetwork: true });
      const wei = await provider.getBalance(relayerAddress);
      const asNumber = Number(ethers.formatEther(wei));
      return {
        ...base,
        nativeBalance: wei.toString(),
        formattedBalance: asNumber.toFixed(4),
        status: statusFor(params.chainKey, asNumber),
      };
    } catch (error: any) {
      /* An unreachable RPC is not a healthy balance. Reporting critical here is deliberate: the
         relayer cannot mint on a chain it cannot reach, whatever the wallet holds. */
      return {
        ...base,
        nativeBalance: "0",
        formattedBalance: "0.0000",
        status: "critical",
        error: error?.shortMessage || "RPC unreachable",
      };
    }
  };

  /* Arc first: it is where inbound deposits mint, and its gas is USDC rather than ETH. */
  const reads: Array<Promise<RelayerBalanceInfo>> = [
    readNative({
      chainKey: "arc",
      rpc: getArcRpcUrl(),
      chainName: isProd ? "Arc" : "Arc Testnet",
      symbol: "USDC",
    }),
  ];

  /* Every CCTP chain in the active environment's config, so adding a chain to CCTP_CONFIG shows up
     here without a second edit. */
  for (const [chainId, info] of Object.entries(CCTP_CONFIG)) {
    reads.push(
      readNative({
        chainKey: chainId,
        rpc: resolveRpcUrl(Number(chainId)),
        chainName: info.name,
        symbol: info.nativeTokenSymbol,
      }),
    );
  }

  /* Solana relayer monitoring: outbound Arc-to-Solana CCTP mints are signed and paid in SOL
     by the dedicated Solana relayer keypair. */
  const solanaRelayerAddress = getSolanaRelayerAddress();
  reads.push(
    (async (): Promise<RelayerBalanceInfo> => {
      const base = {
        chainId: "solana",
        chainName: "Solana",
        nativeTokenSymbol: "SOL",
        walletAddress: solanaRelayerAddress || "Not configured",
      };
      if (!solanaRelayerAddress) {
        return {
          ...base,
          nativeBalance: "0",
          formattedBalance: "0.0000",
          status: "critical",
          error: "No Solana relayer key configured (SOLANA_RELAYER_PRIVATE_KEY)",
        };
      }
      try {
        const connection = getSolanaConnection();
        const { PublicKey } = await import("@solana/web3.js");
        const lamports = await connection.getBalance(new PublicKey(solanaRelayerAddress));
        const sol = lamports / 1e9;
        return {
          ...base,
          nativeBalance: lamports.toString(),
          formattedBalance: sol.toFixed(4),
          status: statusFor("solana", sol),
        };
      } catch (error: any) {
        return {
          ...base,
          nativeBalance: "0",
          formattedBalance: "0.0000",
          status: "critical",
          error: error?.message || "Solana RPC unreachable",
        };
      }
    })(),
  );

  balances.push(...(await Promise.all(reads)));

  return NextResponse.json({
    success: true,
    relayerAddress,
    solanaRelayerAddress,
    environment: isProd ? "mainnet" : "testnet",
    balances,
    lastCheckedAt: new Date().toISOString(),
  });
}
