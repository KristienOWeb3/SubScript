/* Merchant sets / reads the commit required to use their metered service.
   Set is server-signed from the merchant's embedded wallet (on-chain setRequiredCommit). */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { setRequiredCommitFromEmbedded, vaultReadContract } from "@/lib/vault/onchain";

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
        const commit: bigint = await vaultReadContract().requiredCommit(wallet.toLowerCase());
        return NextResponse.json({ success: true, commitUsdc: commit.toString() }, { status: 200 });
    } catch (error: any) {
        console.error("Read required commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to read commit" }, { status: 500 });
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

        const body = sanitizeInput(await request.json().catch(() => null));
        const amount = parseUsdcToMicros(body?.amountUsdc);
        if (amount < BigInt(0)) {
            return NextResponse.json({ error: "Commit must be zero or greater" }, { status: 400 });
        }

        const txHash = await setRequiredCommitFromEmbedded(wallet, amount);
        return NextResponse.json({ success: true, txHash, commitUsdc: amount.toString() }, { status: 200 });
    } catch (error: any) {
        console.error("Set required commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to set commit" }, { status: 500 });
    }
}
