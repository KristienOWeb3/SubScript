import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, isProd } from "@/lib/contracts/constants";

/** Arc settlement and deposit producers must describe the same on-chain confirmation. */
export function arcReceiptEvent(txHash?: string | null, chainId: number = isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID) {
    const hash = txHash?.trim().toLowerCase();
    if (!hash || !/^0x[0-9a-f]{64}$/.test(hash)) return undefined;
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("INVALID_RECEIPT_CHAIN");
    return { chainId, txHash: hash };
}
