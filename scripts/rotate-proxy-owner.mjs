#!/usr/bin/env node
/**
 * Transfers ownership of the SubScriptRouter UUPS proxy away from the
 * compromised deployer key that was committed to the public repository.
 *
 * The proxy owner controls upgrades, so run this BEFORE public testing and
 * point NEW_OWNER at an address whose key has never been committed anywhere
 * (fresh EOA or the ops multi-sig).
 *
 * Usage:
 *   PRIVATE_KEY=<current owner key> NEW_OWNER=0x... CONFIRM_ROTATE=yes \
 *     node --env-file=.env.local scripts/rotate-proxy-owner.mjs
 *
 * Optional env: PROXY_ADDRESS, RPC_URL (default Arc testnet).
 */
import { ethers } from "ethers";

const PROXY_ADDRESS = process.env.PROXY_ADDRESS || "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.arc.network";

const ABI = [
    "function owner() view returns (address)",
    "function transferOwnership(address newOwner) external"
];

async function main() {
    const key = process.env.PRIVATE_KEY;
    if (!key) throw new Error("PRIVATE_KEY must be set to the CURRENT proxy owner key");

    const newOwner = process.env.NEW_OWNER;
    if (!newOwner || !ethers.isAddress(newOwner) || newOwner === ethers.ZeroAddress) {
        throw new Error("NEW_OWNER must be a valid, non-zero address you control");
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(key, provider);
    const proxy = new ethers.Contract(PROXY_ADDRESS, ABI, signer);

    const currentOwner = await proxy.owner();
    console.log(`Proxy:         ${PROXY_ADDRESS}`);
    console.log(`Current owner: ${currentOwner}`);
    console.log(`Signer:        ${signer.address}`);
    console.log(`New owner:     ${newOwner}`);

    if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
        throw new Error("Signer is not the current proxy owner — aborting");
    }
    if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
        console.log("New owner matches current owner — nothing to do.");
        return;
    }

    /* transferOwnership is single-step and irreversible if NEW_OWNER is wrong,
       so prove the destination key is live before allowing the transfer. */
    if (process.env.CONFIRM_ROTATE !== "yes") {
        throw new Error("Set CONFIRM_ROTATE=yes after double-checking you control NEW_OWNER (send a test tx from it first)");
    }

    const tx = await proxy.transferOwnership(newOwner);
    console.log(`transferOwnership sent: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`Transaction reverted: ${tx.hash}`);

    const finalOwner = await proxy.owner();
    console.log(`Confirmed owner: ${finalOwner}`);
    if (finalOwner.toLowerCase() !== newOwner.toLowerCase()) {
        throw new Error("Owner did not change as expected — investigate immediately");
    }
    console.log("Rotation complete. Update PRIVATE_KEY in local env/CI to the new key and treat the old key as burned.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
