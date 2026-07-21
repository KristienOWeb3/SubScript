/* Read-only: re-read a (user → merchant) vault from chain and refresh the off-chain mirror.
   Used after a CLIENT-signed vault commit/withdraw (external/browser wallets), which the server
   can't sign for. No signing happens here — it only reads the chain and upserts the mirror row. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { syncVaultMirror } from "@/lib/vault/onchain";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const merchantAddress = typeof body.merchantAddress === "string" ? body.merchantAddress : "";
        if (!ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

        const v = await syncVaultMirror(wallet.toLowerCase(), merchantAddress.toLowerCase());
        return NextResponse.json({
            success: true,
            vault: {
                balanceUsdc: v.balance.toString(),
                owedUsdc: v.owed.toString(),
                commitUsdc: v.commitNeeded.toString(),
                active: v.active,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault sync failed:", error);
        const isCallException = error?.code === "CALL_EXCEPTION" || error?.message?.includes("CALL_EXCEPTION");
        return NextResponse.json({
            error: isCallException
                ? "Vault contract is unreachable — the on-chain proxy may need to be upgraded. Your transaction may have succeeded; check the chain explorer."
                : (error.message || "Failed to sync vault"),
        }, { status: isCallException ? 503 : 500 });
    }
}
