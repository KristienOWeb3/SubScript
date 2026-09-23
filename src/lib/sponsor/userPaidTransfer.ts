/* Fee-recovery settlement for USER-PAID Arc transactions.
 *
 * On Circle SCA wallets the on-chain gas is fronted by Circle Gas Station and cannot be charged to
 * the wallet directly through the SDK. For user-to-user sends and user withdrawals, SubScript must
 * not absorb that gas, so after the primary transfer settles we debit the sender an accurate,
 * disclosed Arc network fee (see @/lib/sponsor/networkFees) — the recipient always receives the full
 * amount, and the platform is made whole for the Gas Station cost.
 *
 * This deliberately does NOT touch the sponsorship orchestrator: user-paid flows create zero
 * sponsored_gas_operations rows and consume zero merchant-commerce budget.
 */
import { getWalletCustody, deterministicIdempotencyKey } from "@/lib/custody";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { USDC_NATIVE_GAS_ADDRESS, GAS_FEE_TREASURY_ADDRESS } from "@/lib/contracts/constants";

export { estimateArcNetworkFeeMicros } from "@/lib/sponsor/networkFees";
export type { NetworkFeeEstimate } from "@/lib/sponsor/networkFees";

export interface ChargeNetworkFeeResult {
    charged: boolean;
    feeMicros: bigint;
    feeTxHash?: string;
    /** Set when the fee could not be collected AFTER the primary send already settled. */
    unrecovered?: boolean;
}

/**
 * Debit `feeMicros` USDC from `wallet` to the gas-fee treasury, once, as network-fee reimbursement.
 *
 * MUST be called only AFTER the primary transfer has settled: we never charge for a send that did not
 * happen. `requestKey` is the primary operation's stable key (x-request-id derived); the fee reuses
 * it with a `:gasfee` suffix so a retry dedupes at Circle and a batch is charged exactly once.
 *
 * Never throws: the primary send is already irreversible, so a fee-transfer failure is logged for
 * reconciliation (the platform absorbs that one instance) rather than surfaced as a payment error.
 */
export async function chargeNetworkFee(params: {
    wallet: string;
    feeMicros: bigint;
    requestKey: string;
}): Promise<ChargeNetworkFeeResult> {
    const { wallet, feeMicros, requestKey } = params;
    if (feeMicros <= 0n) return { charged: false, feeMicros: 0n };

    try {
        const custody = await getWalletCustody(wallet);
        const { txHash } = await custody.executeContract({
            contractAddress: USDC_NATIVE_GAS_ADDRESS,
            abi: USDC_ERC20_ABI,
            functionName: "transfer",
            args: [GAS_FEE_TREASURY_ADDRESS, feeMicros],
            idempotencyKey: deterministicIdempotencyKey(`${requestKey}:gasfee`),
            gasPayer: "wallet",
        });
        return { charged: true, feeMicros, feeTxHash: txHash };
    } catch (error) {
        console.error(
            "[network-fee] fee-recovery transfer failed after the send settled; platform absorbs this instance:",
            { wallet, feeMicros: feeMicros.toString(), requestKey, error: error instanceof Error ? error.message : error },
        );
        return { charged: false, feeMicros, unrecovered: true };
    }
}
