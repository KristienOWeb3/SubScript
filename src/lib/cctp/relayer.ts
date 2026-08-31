import { ethers } from "ethers";
import { CCTP_CONFIG } from "@/lib/contracts/constants";

/**
 * Single source of truth for which key relays CCTP mints and which RPC each chain uses.
 *
 * The admin relayer-balances card and the attestation worker both read from here on purpose. When
 * they resolved the key independently the dashboard watched SPONSOR_PRIVATE_KEY while the worker
 * signed with RELAYER_PRIVATE_KEY, so the balance panel read healthy while the wallet doing the work
 * was empty.
 */

/** Prefers a dedicated relayer key, falls back to the Arc sponsor key. */
export function getRelayerPrivateKey(): string | null {
  return process.env.RELAYER_PRIVATE_KEY || process.env.SPONSOR_PRIVATE_KEY || null;
}

/** The address that actually pays for mints, derived from the key rather than configured twice. */
export function getRelayerAddress(): string | null {
  const key = getRelayerPrivateKey();
  if (key) {
    try {
      return new ethers.Wallet(key).address;
    } catch {
      /* Malformed key: fall through to the explicitly configured address. */
    }
  }
  const configured = process.env.RELAYER_WALLET_ADDRESS || process.env.SPONSOR_WALLET_ADDRESS;
  return configured && /^0x[a-fA-F0-9]{40}$/.test(configured.trim()) ? configured.trim() : null;
}

export function getArcRpcUrl(): string {
  return (
    process.env.ARC_RPC_URL ||
    process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
    "https://rpc.testnet.arc.network"
  );
}

/**
 * RPC for a CCTP chain. `RPC_URL_<chainId>` wins, then the public default in CCTP_CONFIG.
 */
export function resolveRpcUrl(chainId: number): string | null {
  return (
    process.env[`RPC_URL_${chainId}`] ||
    process.env[`NEXT_PUBLIC_RPC_${chainId}`] ||
    CCTP_CONFIG[chainId]?.defaultRpc ||
    null
  );
}

export function getArcRelayer(): ethers.Wallet {
  const key = getRelayerPrivateKey();
  if (!key) {
    throw new Error("No relayer key configured. Set RELAYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY).");
  }
  return new ethers.Wallet(key, new ethers.JsonRpcProvider(getArcRpcUrl(), undefined, { staticNetwork: true }));
}

export function getChainRelayer(chainId: number): ethers.Wallet {
  const key = getRelayerPrivateKey();
  if (!key) {
    throw new Error("No relayer key configured. Set RELAYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY).");
  }
  const rpc = resolveRpcUrl(chainId);
  if (!rpc) {
    throw new Error(`No RPC configured for chain ${chainId}. Set RPC_URL_${chainId}.`);
  }
  return new ethers.Wallet(key, new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true }));
}
