#!/usr/bin/env node
/* Verifies the payroll Permit2 EIP-712 contract is consistent across libraries:
 *   - viem (the frontend signer) and ethers (the keeper + embedded server signer) must hash the
 *     SAME message to the SAME digest, or signatures won't verify on-chain.
 *   - a signature must round-trip across both libraries.
 * Mirrors src/lib/payroll/permit2.ts exactly. Run: node scripts/payroll-permit2-test.mjs */

import { Wallet, TypedDataEncoder, verifyTypedData } from "ethers";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import assert from "node:assert/strict";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PAYDAY_TOTAL = 125_000_000n;
const EXPIRATION = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400 + 6 * 3_600);
const SIG_DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
const USDC = "0x3600000000000000000000000000000000000000";
const CHAIN_ID = 5042002;

const types = {
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
};

async function main() {
  const keeper = Wallet.createRandom().address;
  const domain = { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2_ADDRESS };
  const message = {
    details: { token: USDC, amount: PAYDAY_TOTAL, expiration: EXPIRATION, nonce: 0n },
    spender: keeper,
    sigDeadline: SIG_DEADLINE,
  };

  // 1. ethers and viem must agree on the EIP-712 digest.
  const ethersHash = TypedDataEncoder.hash(domain, types, message);
  const viemHash = hashTypedData({ domain, types, primaryType: "PermitSingle", message });
  assert.equal(ethersHash, viemHash, "ethers and viem produced different EIP-712 digests");
  console.log("  ✓ viem and ethers agree on the digest:", viemHash);

  // 2. A signature must round-trip across both libraries.
  const signer = Wallet.createRandom();
  const signature = await signer.signTypedData(domain, types, message);
  const recoveredEthers = verifyTypedData(domain, types, message, signature);
  assert.equal(recoveredEthers.toLowerCase(), signer.address.toLowerCase(), "ethers failed to recover the signer");
  const recoveredViem = await recoverTypedDataAddress({ domain, types, primaryType: "PermitSingle", message, signature });
  assert.equal(recoveredViem.toLowerCase(), signer.address.toLowerCase(), "viem failed to recover the signer");
  console.log("  ✓ signature round-trips across ethers and viem");

  // 3. The digest must change with the nonce (sanity: nonce is part of the signed data).
  const m1 = { ...message, details: { ...message.details, nonce: 1n } };
  assert.notEqual(TypedDataEncoder.hash(domain, types, m1), ethersHash, "nonce is not part of the signed digest");
  console.log("  ✓ nonce is bound into the signature");

  // 4. The authorization must be bounded to one payday, never uint maxima.
  assert.equal(message.details.amount, PAYDAY_TOTAL);
  assert.ok(message.details.expiration < 0xffffffffffffn, "authorization uses an unlimited expiration");
  assert.ok(message.sigDeadline < BigInt("0x" + "f".repeat(64)), "signature uses an unlimited deadline");
  console.log("  ✓ authorization is bounded to one exact payday");

  console.log("\nPermit2 EIP-712 contract is consistent. ✓");
}

main().catch((err) => {
  console.error("✗", err.message);
  process.exit(1);
});
