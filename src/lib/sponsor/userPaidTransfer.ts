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
import { prisma } from "@/lib/prisma";

export { estimateArcNetworkFeeMicros } from "@/lib/sponsor/networkFees";
export type { NetworkFeeEstimate } from "@/lib/sponsor/networkFees";

export interface ChargeNetworkFeeResult {
    charged: boolean;
    feeMicros: bigint;
    feeTxHash?: string;
    /** Set when the fee could not be collected AFTER the primary send already settled. */
    unrecovered?: boolean;
}

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function normalizedParentHashes(hashes: string[] | undefined): string[] {
    return Array.from(new Set(
        (hashes || [])
            .map((hash) => hash.toLowerCase())
            .filter((hash) => TX_HASH_PATTERN.test(hash)),
    ));
}

async function recordNetworkFeeRecovery(params: {
    wallet: string;
    feeMicros: bigint;
    requestKey: string;
    parentTransactionHashes: string[];
    feeTxHash: string | null;
    recoveryStatus: "CHARGED" | "UNRECOVERED";
}) {
    const feeTxHash = params.feeTxHash?.toLowerCase() || null;
    await prisma.arcNetworkFeeRecovery.upsert({
        where: { requestKey: params.requestKey },
        create: {
            transactionType: "ARC_NETWORK_FEE",
            requestKey: params.requestKey,
            senderWallet: params.wallet.toLowerCase(),
            treasuryRecipient: GAS_FEE_TREASURY_ADDRESS.toLowerCase(),
            feeMicros: params.feeMicros,
            feeTxHash,
            parentTransactionHashes: params.parentTransactionHashes,
            recoveryStatus: params.recoveryStatus,
        },
        update: {
            feeMicros: params.feeMicros,
            feeTxHash,
            parentTransactionHashes: params.parentTransactionHashes,
            recoveryStatus: params.recoveryStatus,
        },
    });
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
    /** Primary transfer hashes linked to this operational reimbursement. */
    parentTransactionHashes?: string[];
}): Promise<ChargeNetworkFeeResult> {
    const { wallet, feeMicros, requestKey } = params;
    if (feeMicros <= 0n) return { charged: false, feeMicros: 0n };
    const parentTransactionHashes = normalizedParentHashes(params.parentTransactionHashes);

    /* Database idempotency is the first line of defence. The provider key below remains the final
       guard if a previous on-chain transfer succeeded but its ledger write was interrupted. */
    const existing = await prisma.arcNetworkFeeRecovery.findUnique({
        where: { requestKey },
        select: { recoveryStatus: true, feeMicros: true, feeTxHash: true },
    }).catch(() => null);
    if (existing?.recoveryStatus === "CHARGED" && existing.feeTxHash) {
        return { charged: true, feeMicros: existing.feeMicros, feeTxHash: existing.feeTxHash };
    }

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
        await recordNetworkFeeRecovery({
            wallet,
            feeMicros,
            requestKey,
            parentTransactionHashes,
            feeTxHash: txHash,
            recoveryStatus: "CHARGED",
        }).catch((error) => {
            console.error("[network-fee] fee was charged but its accounting record could not be persisted:", {
                wallet,
                feeMicros: feeMicros.toString(),
                requestKey,
                feeTxHash: txHash,
                error: error instanceof Error ? error.message : error,
            });
        });
        return { charged: true, feeMicros, feeTxHash: txHash };
    } catch (error) {
        console.error(
            "[network-fee] fee-recovery transfer failed after the send settled; platform absorbs this instance:",
            { wallet, feeMicros: feeMicros.toString(), requestKey, error: error instanceof Error ? error.message : error },
        );
        await recordNetworkFeeRecovery({
            wallet,
            feeMicros,
            requestKey,
            parentTransactionHashes,
            feeTxHash: null,
            recoveryStatus: "UNRECOVERED",
        }).catch((recordError) => {
            console.error("[network-fee] unrecovered fee could not be persisted for reconciliation:", {
                wallet,
                feeMicros: feeMicros.toString(),
                requestKey,
                error: recordError instanceof Error ? recordError.message : recordError,
            });
        });
        return { charged: false, feeMicros, unrecovered: true };
    }
}
