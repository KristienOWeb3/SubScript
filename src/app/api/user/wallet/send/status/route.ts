import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { getArcTransferStatus, getCircleTransactionStatus } from "@/lib/custody";
import { resolveSpendingAuthority } from "@/lib/commitId";

export const maxDuration = 30;

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const url = new URL(request.url);
        const circleTxId = url.searchParams.get("circleTxId") || url.searchParams.get("id");
        const txHash = url.searchParams.get("txHash") || url.searchParams.get("hash");

        if (!circleTxId && !txHash) {
            return NextResponse.json({ error: "Missing circleTxId or txHash parameter" }, { status: 400 });
        }
        const { fundingWallet } = await resolveSpendingAuthority(wallet.toLowerCase());

        // 1. If circleTxId is provided, check Circle status and cross-reference Arc RPC
        if (circleTxId) {
            const status = await getCircleTransactionStatus(circleTxId, fundingWallet);
            return NextResponse.json({
                status: status.status,
                txHash: status.txHash || null,
                state: status.state || null,
                error: status.error || null,
            });
        }

        // 2. If txHash is provided directly (e.g. browser wallet send)
        if (txHash) {
            return NextResponse.json(await getArcTransferStatus(txHash, fundingWallet));
        }

        return NextResponse.json({ status: "pending" });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Failed to check status" }, { status: 500 });
    }
}
