import { getWalletCustody, isCustodialWallet } from "./walletCustody";

/** Server-owned custody records decide applicability; client wallet-type flags are ignored. */
export async function transactionPinRequiredForWallet(wallet: string): Promise<boolean> {
    // No embedded-wallet record after a successful lookup means an external wallet.
    // Storage errors propagate and fail closed rather than granting a bypass.
    return isCustodialWallet(await getWalletCustody(wallet));
}
