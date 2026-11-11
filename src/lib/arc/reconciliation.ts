import { ARC_MAINNET, ARC_TESTNET, ARC_TESTNET_CHAIN_ID, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { ACTIVE_ARC_CHAIN_ID } from "@/lib/network/registry";

/* Canonical on-chain settlement details so an integrator can independently verify that a
   payment landed: which chain, which USDC contract, and a direct explorer link to the tx.

   The chain defaults to the ACTIVE deployment (Arc Mainnet in production), and the explorer
   follows the chain the payment actually settled on, so a test-mode payment served from a
   mainnet deployment still links to the testnet explorer and vice versa. */
export function arcReconciliation(
    txHash?: string | null,
    chainId: number = ACTIVE_ARC_CHAIN_ID
) {
    const explorerBase = chainId === ARC_TESTNET_CHAIN_ID
        ? ARC_TESTNET.blockExplorers.default.url
        : ARC_MAINNET.blockExplorers.default.url;
    return {
        chainId,
        usdcAddress: USDC_NATIVE_GAS_ADDRESS,
        explorerUrl: explorerBase,
        explorerTxUrl: txHash ? `${explorerBase}/tx/${txHash}` : null,
    };
}
