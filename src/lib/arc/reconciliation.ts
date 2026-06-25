import { ARC_TESTNET_CHAIN_ID, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

/* Canonical on-chain settlement details so an integrator can independently verify that a
   payment landed: which chain, which USDC contract, and a direct explorer link to the tx. */
const ARC_EXPLORER_BASE = "https://explorer.arc.network";

export function arcReconciliation(
    txHash?: string | null,
    chainId: number = ARC_TESTNET_CHAIN_ID
) {
    return {
        chainId,
        usdcAddress: USDC_NATIVE_GAS_ADDRESS,
        explorerUrl: ARC_EXPLORER_BASE,
        explorerTxUrl: txHash ? `${ARC_EXPLORER_BASE}/tx/${txHash}` : null,
    };
}
