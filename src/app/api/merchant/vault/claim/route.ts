/* Merchant withdraws settled vault funds (drawn usage) from the escrow contract.
   Reads claimable via GET; server-signed merchantClaim() via POST. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { claimMerchantFromEmbedded, vaultReadContract } from "@/lib/vault/onchain";

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
        const txHash = await claimMerchantFromEmbedded(wallet);
        return NextResponse.json({ success: true, txHash }, { status: 200 });
    } catch (error: any) {
        console.error("Merchant claim failed:", error);
        return NextResponse.json({ error: error.message || "Failed to claim" }, { status: 500 });
    }
}
