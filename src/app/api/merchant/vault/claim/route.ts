/* Merchant withdraws settled vault funds (drawn usage) from the escrow contract.
   Reads claimable via GET; server-signed merchantClaim() via POST. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
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

export async function POST(request: Request) {
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

        const txHash = await claimMerchantFromEmbedded(wallet);
        return NextResponse.json({ success: true, txHash }, { status: 200 });
    } catch (error: any) {
        if (error instanceof WithdrawalHeldError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Merchant claim failed:", error);
        return NextResponse.json({ error: error.message || "Failed to claim" }, { status: 500 });
    }
}
