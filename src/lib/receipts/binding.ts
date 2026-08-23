import { SupabaseClient } from "@supabase/supabase-js";
import { generateReceiptId, receiptUrl, buildConfidentialMemoPayload } from "@/lib/arc/memo";
import { ProtocolConfig } from "@/lib/payments/config";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";

export interface BindTxToReceiptInput {
    txHash: string;
    receiptId?: string | null;
    payerAddress: string;
    merchantAddress: string;
    amountUsdc: bigint | string | number;
    title?: string | null;
    paymentLinkId?: string | null;
    paymentLinkPaymentId?: string | null;
    beneficiaryAddress?: string | null;
    chainId?: number;
    memoContract?: string;
    isShielded?: boolean;
    merchantViewKeyHash?: string | null;
    confirmedAt?: string;
}

export interface BindTxToReceiptResult {
    receiptId: string;
    txHash: string;
    shareUrl: string;
    status: string;
    isShielded: boolean;
}

/**
 * Durably binds a transaction hash (including Circle wallet transactions and Arc shielded transfers)
 * to an off-chain receipt record in Supabase so platform owners and merchants can track,
 * audit, and prove transactions using the transaction hash.
 */
export async function bindTxToReceipt(
    supabase: SupabaseClient,
    input: BindTxToReceiptInput
): Promise<BindTxToReceiptResult> {
    const normalizedTx = input.txHash.toLowerCase();
    const normalizedPayer = input.payerAddress.toLowerCase();
    const normalizedMerchant = input.merchantAddress.toLowerCase();
    const normalizedBeneficiary = input.beneficiaryAddress ? input.beneficiaryAddress.toLowerCase() : null;

    const receiptId = input.receiptId && input.receiptId.startsWith("rcpt-")
        ? input.receiptId
        : generateReceiptId(input.title || "SubScript Receipt");

    const chainId = input.chainId ?? ProtocolConfig.CHAIN_ID;
    const memoContract = input.memoContract || SUBSCRIPT_ROUTER_ADDRESS.toLowerCase();
    const amountStr = typeof input.amountUsdc === "bigint"
        ? input.amountUsdc.toString()
        : String(input.amountUsdc);

    const shareUrl = receiptUrl(receiptId);
    const isShielded = !!input.isShielded;
    const memoNote = buildConfidentialMemoPayload({
        receiptId,
        merchantViewKeyHash: input.merchantViewKeyHash,
        isShielded,
    });

    const confirmedAt = input.confirmedAt || new Date().toISOString();

    const receiptRow = {
        receipt_id: receiptId,
        payment_link_id: input.paymentLinkId || null,
        payment_link_payment_id: input.paymentLinkPaymentId || null,
        tx_hash: normalizedTx,
        chain_id: chainId,
        memo_contract: memoContract,
        payer_address: normalizedPayer,
        beneficiary_address: normalizedBeneficiary,
        merchant_address: normalizedMerchant,
        amount_usdc: amountStr,
        title: input.title?.trim() || null,
        memo_note: memoNote,
        share_url: shareUrl,
        status: "CONFIRMED",
        confirmed_at: confirmedAt,
        updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
        .from("receipts")
        .upsert(receiptRow, { onConflict: "tx_hash" });

    if (error) {
        console.error(`[receipt-binding] Failed to bind tx ${normalizedTx} to receipt ${receiptId}:`, error.message);
        throw new Error(`Receipt binding failed: ${error.message}`);
    }

    return {
        receiptId,
        txHash: normalizedTx,
        shareUrl,
        status: "CONFIRMED",
        isShielded,
    };
}
