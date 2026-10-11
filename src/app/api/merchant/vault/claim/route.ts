import { financialPinContext } from "@/lib/auth/financialPinPolicy";
import { withTransactionPin } from "@/lib/auth/transactionPin";
/* Merchant withdraws settled vault funds (drawn usage) from the escrow contract.
   Reads claimable via GET; server-signed merchantClaim() via POST. */
import { after, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import crypto from "node:crypto";
import { SUBSCRIPT_VAULT_ADDRESS, SUBSCRIPT_VAULT_CHAIN_ID } from "@/lib/contracts/constants";
import { prepareSettlementReceiptJob, recordSettlementReceiptSubmission, confirmSettlementReceiptJob, dispatchSettlementReceipts } from "@/lib/payments/settlementReceiptRecovery";
import { claimMerchantFromEmbedded, vaultReadContract } from "@/lib/vault/onchain";
import { assertWithdrawalAllowed, WithdrawalHeldError } from "@/lib/admin/withdrawalHolds";

export const maxDuration = 120;

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        const claimable: bigint = await vaultReadContract().merchantClaimable(wallet.toLowerCase());
        return NextResponse.json({ success: true, claimableUsdc: claimable.toString() }, { status: 200 });
    } catch (error: any) {
        console.error("Read claimable failed:", error);
        return NextResponse.json({ error: error.message || "Failed to read claimable" }, { status: 500 });
    }
}

async function handlePOST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        /* Admin withdrawal hold. Only POST is gated: GET merely reports what is claimable, and
           blocking that would hide the balance from a merchant who still needs to reconcile it
           while the hold is being resolved. MERCHANT scope, so freezing a merchant payout does
           not also freeze the same person's unrelated consumer vault refunds. */
        await assertWithdrawalAllowed(wallet, "MERCHANT");

        const requestId = request.headers.get("x-transaction-operation-id") || request.headers.get("x-request-id") || crypto.randomUUID();
        const receiptJobId = await prepareSettlementReceiptJob({
            identity: `vault-claim:${requestId}:${wallet.toLowerCase()}`,
            kind: "vault_claim", fundingWallet: wallet, payerAddress: null, payeeAddress: wallet,
            contractAddress: SUBSCRIPT_VAULT_ADDRESS, chainId: SUBSCRIPT_VAULT_CHAIN_ID,
        });
        const txHash = await claimMerchantFromEmbedded(wallet,
            id => recordSettlementReceiptSubmission(receiptJobId, id), `vault-claim:${requestId}:${wallet.toLowerCase()}`);
        await confirmSettlementReceiptJob(receiptJobId, txHash).catch(() => null);
        after(async () => { await dispatchSettlementReceipts().catch(() => null); });

        return NextResponse.json({ success: true, txHash }, { status: 200 });
    } catch (error: any) {
        if (error instanceof WithdrawalHeldError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Merchant claim failed:", error);
        return NextResponse.json({ error: error.message || "Failed to claim" }, { status: 500 });
    }
}

export const POST = withTransactionPin({ action: "merchant-vault-claim", bind: financialPinContext }, handlePOST);
