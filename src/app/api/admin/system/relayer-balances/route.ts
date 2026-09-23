import { NextResponse } from "next/server";
import { requireScope } from "@/lib/admin/guard";
import { CCTP_CONFIG, isProd } from "@/lib/contracts/constants";
import { getArcRpcUrl, getRelayerAddress, resolveRpcUrl } from "@/lib/cctp/relayer";
import { getSolanaRelayerAddress } from "@/lib/cctp/solanaRelayer";
import { readEvmNativeBalance, readSolanaNativeBalance, statusFor } from "@/lib/cctp/relayerGas";
import type { RelayerBalanceInfo } from "@/lib/cctp/types";

export const maxDuration = 60;

/**
 * Native gas balances for every chain the CCTP relayer mints on.
 *
 * The address comes from lib/cctp/relayer, the same helper the attestation worker signs with. When
 * this route derived its own address from SPONSOR_PRIVATE_KEY it reported a healthy balance for a
 * wallet that was not the one paying for mints. Thresholds and balance reads live in lib/cctp/relayerGas
 * so this panel and the live route-availability guard cannot disagree about what "critical" means.
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
    const read = await readEvmNativeBalance(params.rpc, relayerAddress);
    if (read.balance === null) {
      return { ...base, nativeBalance: read.raw, formattedBalance: "0.0000", status: "critical", error: read.error };
    }
    return {
      ...base,
      nativeBalance: read.raw,
      formattedBalance: read.balance.toFixed(4),
      status: statusFor(params.chainKey, read.balance),
    };
  };

  /* Arc first: it is where inbound deposits mint, and its gas is USDC rather than ETH. */
  const reads: Array<Promise<RelayerBalanceInfo>> = [
    readNative({
      chainKey: "arc",
      rpc: getArcRpcUrl(),
      chainName: isProd ? "Arc Mainnet" : "Arc Testnet",
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
      const read = await readSolanaNativeBalance(solanaRelayerAddress);
      if (read.balance === null) {
        return { ...base, nativeBalance: read.raw, formattedBalance: "0.0000", status: "critical", error: read.error };
      }
      return {
        ...base,
        nativeBalance: read.raw,
        formattedBalance: read.balance.toFixed(4),
        status: statusFor("solana", read.balance),
      };
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
