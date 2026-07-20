/* User withdraws unused escrow from a vault back to their wallet. Allowed only when
   the vault carries no owed debt; dropping below the commit deactivates the service
   until the user re-commits. Server-signed from the user's embedded wallet. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { withdrawFromEmbedded, syncVaultMirror } from "@/lib/vault/onchain";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import crypto from "crypto";

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
        const { merchantAddress, amountUsdc, requestId } = body || {};
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const amount = parseUsdcToMicros(amountUsdc);
        if (amount <= BigInt(0)) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        const reqId = request.headers.get("x-request-id")?.trim() || requestId || crypto.randomUUID();
        const sponsorRequestKey = `vault-withdraw:${reqId}:${wallet.toLowerCase()}:${merchantAddress.toLowerCase()}:${amount.toString()}`;

        await requireSponsoredGas({
            wallet: wallet.toLowerCase(),
            action: "vault_withdraw",
            requestKey: sponsorRequestKey,
        });

        const txHash = await withdrawFromEmbedded(wallet, merchantAddress, amount);
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
        console.error("Vault withdraw failed:", error);
        return NextResponse.json({ error: error.message || "Failed to withdraw from vault" }, { status: 500 });
    }
}
