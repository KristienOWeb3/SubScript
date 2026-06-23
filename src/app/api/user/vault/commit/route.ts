/* User commits (escrows) USDC into a (user → merchant) vault. Clears any owed debt
   first, then restores the commit; the merchant's service activates for the cycle.
   Server-signed from the user's embedded wallet. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole, getAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { commitFromEmbedded, syncVaultMirror } from "@/lib/vault/onchain";

export const maxDuration = 120;

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

        const body = sanitizeInput(await request.json().catch(() => null));
        const { merchantAddress, amountUsdc } = body || {};
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const merchantRole = await getAccountRole(merchantAddress.toLowerCase());
        if (merchantRole !== "ENTERPRISE") {
            return NextResponse.json({ error: "Vaults can only be funded for merchant services." }, { status: 400 });
        }
        const amount = parseUsdcToMicros(amountUsdc);
        if (amount <= BigInt(0)) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        const txHash = await commitFromEmbedded(wallet, merchantAddress, amount);
        const v = await syncVaultMirror(wallet, merchantAddress);

        return NextResponse.json({
            success: true,
            txHash,
            vault: {
                balanceUsdc: v.balance.toString(),
                owedUsdc: v.owed.toString(),
                commitUsdc: v.commitNeeded.toString(),
                active: v.active,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to commit to vault" }, { status: 500 });
    }
}
