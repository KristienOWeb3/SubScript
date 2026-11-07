import { getWalletCustody, circleIdempotencyKey, CirclePaymasterPolicyError } from "@/lib/custody";
import { assertNotBlocked } from "@/lib/dms/blocks";
import { assertWithdrawalAllowed } from "@/lib/admin/withdrawalHolds";
import { assertAccountNotHalted } from "@/lib/accountHalt";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { readProvider } from "@/lib/vault/onchain";
import { inspectSettlementReceipt, recordSettlementReceiptSubmission, confirmSettlementReceiptJob } from "@/lib/payments/settlementReceiptRecovery";
import {
    checkAndReserveSpendingLimit, retainSubmittedSpendingLimitOperation,
    bindSubmittedSpendingLimitOperation, finalizeSpendingLimitOperation, releaseSpendingLimitOperation,
} from "@/lib/spendingLimits";

export class UserTransferPolicyError extends Error {
    constructor(message: string, public status: number, public code: string, public operationId?: string) { super(message); }
}

/** Shared custodial USER outflow boundary for dispatcher and peer checkouts.
 * A timed-out accepted transfer retains its cap and its original provider key. */
export async function executeUserTransfer(input: {
    wallet: string; recipient: string; amountMicros: bigint; identity: string;
    receiptJobId?: string;
    onSubmitted?: (id: string) => Promise<void>;
}): Promise<string> {
    const wallet = input.wallet.toLowerCase(), recipient = input.recipient.toLowerCase();
    await assertNotBlocked(wallet, recipient, "sending funds");
    await assertWithdrawalAllowed(wallet, "USER");
    await assertAccountNotHalted(wallet);
    // Resolve custody before reserving; a browser-only wallet cannot submit here.
    const custody = await getWalletCustody(wallet);
    const identity = circleIdempotencyKey(input.identity);
    const reservation = await checkAndReserveSpendingLimit(wallet, input.amountMicros, "DIRECT_SEND", identity);
    if (!reservation.allowed || !reservation.operationId) {
        throw new UserTransferPolicyError(reservation.reason || "Transfer exceeds your spending limit.", 403, reservation.code || "SPENDING_LIMIT_EXCEEDED");
    }
    const operationId = reservation.operationId;
    let submitted = Boolean(reservation.reused);
    try {
        const receiptJobId = input.receiptJobId;
        await retainSubmittedSpendingLimitOperation(operationId);
        submitted = true; // A lost acceptance response cannot prove that nothing moved.
        const result = await custody.executeContract({
            contractAddress: USDC_NATIVE_GAS_ADDRESS,
            abi: ["function transfer(address to,uint256 amount) returns (bool)"],
            functionName: "transfer", args: [recipient, input.amountMicros],
            idempotencyKey: identity, gasPayer: "wallet",
            onSubmitted: async id => {
                await Promise.all([
                    bindSubmittedSpendingLimitOperation(operationId, id),
                    receiptJobId ? recordSettlementReceiptSubmission(receiptJobId, id) : undefined,
                    input.onSubmitted?.(id),
                ]);
            },
        });
        if (receiptJobId && result.txHash) await confirmSettlementReceiptJob(receiptJobId,result.txHash).catch(()=>undefined);
        const receipt = await readProvider().getTransactionReceipt(result.txHash);
        const proof = receipt ? inspectSettlementReceipt({kind: "wallet_transfer", funding_wallet: wallet,
            payee_address: recipient, amount_usdc: input.amountMicros.toString(), contract_address: USDC_NATIVE_GAS_ADDRESS.toLowerCase()}, receipt) : null;
        if (proof?.state === "failed") {
            submitted = false;
            throw new UserTransferPolicyError("The USDC transfer reverted on Arc.", 422, "TRANSFER_REVERTED", operationId);
        }
        if (proof?.state !== "confirmed") throw new Error("Transfer execution is not yet verified.");
        await finalizeSpendingLimitOperation(operationId, input.amountMicros);
        return result.txHash;
    } catch (error) {
        if (error instanceof CirclePaymasterPolicyError && !reservation.reused) submitted = false;
        if (!submitted) {
            await releaseSpendingLimitOperation(operationId);
            throw error;
        }
        if (error instanceof UserTransferPolicyError) throw error;
        throw new UserTransferPolicyError("The transfer outcome is pending verification. Do not create another payment; check this operation's status.", 202, "TRANSFER_PENDING", operationId);
    }
}
