import { ethers } from "ethers";

/* Read-only verification that an address is a Gnosis Safe the merchant controls.
   No custom contracts and no transactions — we only read getOwners()/getThreshold() so a merchant
   can't accidentally route payouts to a non-Safe or a Safe they don't own. */

const SAFE_ABI = [
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
];

export interface SafeInfo {
    isSafe: boolean;
    isOwner: boolean;
    threshold: number;
    ownerCount: number;
    owners: string[];
    error?: string;
}

function readProvider() {
    const url =
        process.env.ARC_RPC_PRIMARY ||
        process.env.RPC_URL ||
        "https://rpc.testnet.arc.network";
    return new ethers.JsonRpcProvider(url);
}

export async function verifySafe(safeAddress: string, ownerAddress: string): Promise<SafeInfo> {
    const empty: SafeInfo = { isSafe: false, isOwner: false, threshold: 0, ownerCount: 0, owners: [] };

    if (!ethers.isAddress(safeAddress)) {
        return { ...empty, error: "That is not a valid address." };
    }

    try {
        const provider = readProvider();
        const code = await provider.getCode(safeAddress);
        if (!code || code === "0x") {
            return { ...empty, error: "No contract is deployed at that address on Arc — it isn't a Safe." };
        }

        const safe = new ethers.Contract(safeAddress, SAFE_ABI, provider);
        const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
        const ownersLower = (owners as string[]).map((o) => o.toLowerCase());

        return {
            isSafe: true,
            isOwner: ownersLower.includes(ownerAddress.toLowerCase()),
            threshold: Number(threshold),
            ownerCount: ownersLower.length,
            owners: ownersLower,
        };
    } catch {
        return { ...empty, error: "That address doesn't respond as a Gnosis Safe (getOwners/getThreshold failed)." };
    }
}
