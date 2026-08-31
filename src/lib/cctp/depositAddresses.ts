import { ethers } from "ethers";
import { resolveRpcUrl, getRelayerPrivateKey } from "./relayer";

/**
 * Per-user derived deposit addresses for cross-chain CCTP deposits.
 *
 * Each user gets a deterministic, unique EOA deposit address derived from the relayer's master key.
 * The relayer can reconstruct any user's signing key on demand — no per-user key storage needed.
 *
 * Derivation: keccak256(relayerPrivateKey ++ normalizedUserWallet) → private key → address
 *
 * Because these are plain EOAs, the address is identical on every EVM chain, which is exactly what
 * CCTP needs: the user can send USDC to the same address on Base, Arbitrum, Ethereum, etc.
 *
 * SECURITY: The relayer key and derivation logic MUST stay server-side. The frontend receives only
 * the derived address via API — never the key, the seed, or the derivation formula.
 */

/**
 * Derives a deterministic private key for a user's deposit address.
 * Throws if the relayer key is not configured.
 */
function derivePrivateKey(userWallet: string): string {
  const relayerKey = getRelayerPrivateKey();
  if (!relayerKey) {
    throw new Error("No relayer key configured. Set RELAYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY.");
  }

  const normalized = userWallet.toLowerCase().trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Invalid wallet address for derivation: ${userWallet}`);
  }

  /* The seed is the relayer's raw key bytes concatenated with the user's address bytes.
     keccak256 produces a 256-bit value that is a valid secp256k1 private key with overwhelming
     probability (the only invalid values are 0 and values >= the curve order n, which is
     ~1.158e77 — collision probability is negligible). */
  const relayerKeyBytes = ethers.getBytes(
    relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`
  );
  const walletBytes = ethers.getBytes(normalized);
  const seed = ethers.concat([relayerKeyBytes, walletBytes]);

  return ethers.keccak256(seed);
}

/**
 * Returns the derived deposit address for a user. Deterministic — same input always gives same
 * output. Same address on every EVM chain.
 */
export function deriveDepositAddress(userWallet: string): string {
  const privateKey = derivePrivateKey(userWallet);
  return new ethers.Wallet(privateKey).address.toLowerCase();
}

/**
 * Returns an ethers.Wallet for a user's derived deposit address, connected to the given chain's
 * RPC. Used by the auto-bridge to sign approve + depositForBurn on the origin chain.
 */
export function deriveDepositSigner(userWallet: string, chainId: number): ethers.Wallet {
  const privateKey = derivePrivateKey(userWallet);
  const rpc = resolveRpcUrl(chainId);
  if (!rpc) {
    throw new Error(`No RPC configured for chain ${chainId}. Set RPC_URL_${chainId}.`);
  }
  return new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true }));
}

/**
 * Checks whether an address is a valid derived deposit address for the given user.
 * Useful for verifying API inputs.
 */
export function isValidDerivedAddress(userWallet: string, address: string): boolean {
  try {
    return deriveDepositAddress(userWallet) === address.toLowerCase().trim();
  } catch {
    return false;
  }
}
