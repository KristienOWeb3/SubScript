import { ethers } from "ethers";
import { getSolanaConnection } from "@/lib/cctp/solanaRelayer";
import type { RelayerBalanceInfo } from "@/lib/cctp/types";

/**
 * Single source of truth for relayer native-gas thresholds and balance reads.
 *
 * Both the admin relayer-balances panel and the live route-availability checker read from here so a
 * "critical" verdict means the same number in the dashboard and in the withdrawal guard. When the two
 * kept their own copies of these thresholds they were one edit away from disagreeing about whether a
 * route was safe to burn on.
 */

/* Native gas thresholds per chain, in whole tokens. Polygon is denominated in POL, Solana in SOL,
   everything else in ETH, which is why they cannot share one number. Keys are the route ids the rest
   of the CCTP code uses: "arc", "solana", or a chain id as a string. Testnet chain ids (11155111,
   80002, …) intentionally fall to `default`; only Ethereum and Polygon mainnet get their own line. */
export const RELAYER_GAS_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  arc: { warning: 10, critical: 2 },
  "1": { warning: 0.1, critical: 0.02 },
  "137": { warning: 10, critical: 2 },
  solana: { warning: 0.2, critical: 0.05 },
  default: { warning: 0.05, critical: 0.01 },
};

export function statusFor(chainKey: string, balance: number): RelayerBalanceInfo["status"] {
  const { warning, critical } = RELAYER_GAS_THRESHOLDS[chainKey] ?? RELAYER_GAS_THRESHOLDS.default;
  if (balance > warning) return "healthy";
  if (balance > critical) return "warning";
  return "critical";
}

/* `balance` is human units (ETH/SOL/POL/USDC), or null when the read failed. `raw` is the underlying
   integer (wei/lamports) as a string, kept so the admin panel can report it verbatim. */
export type NativeBalanceRead = { balance: number | null; raw: string; error?: string };

export async function readEvmNativeBalance(rpc: string | null, address: string): Promise<NativeBalanceRead> {
  if (!rpc) return { balance: null, raw: "0", error: "No RPC configured" };
  try {
    const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
    const wei = await provider.getBalance(address);
    return { balance: Number(ethers.formatEther(wei)), raw: wei.toString() };
  } catch (error: any) {
    /* An unreachable RPC is not a healthy balance. Reporting a failed read (which callers treat as
       critical / unavailable) is deliberate: the relayer cannot mint on a chain it cannot reach,
       whatever the wallet holds. */
    return { balance: null, raw: "0", error: error?.shortMessage || "RPC unreachable" };
  }
}

export async function readSolanaNativeBalance(address: string): Promise<NativeBalanceRead> {
  try {
    const connection = getSolanaConnection();
    const { PublicKey } = await import("@solana/web3.js");
    const lamports = await connection.getBalance(new PublicKey(address));
    return { balance: lamports / 1e9, raw: lamports.toString() };
  } catch (error: any) {
    return { balance: null, raw: "0", error: error?.message || "Solana RPC unreachable" };
  }
}
