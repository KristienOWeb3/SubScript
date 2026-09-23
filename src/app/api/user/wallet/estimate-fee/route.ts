/* Read-only Arc network-fee estimate for the send UI. USER→USER sends and user withdrawals are
   user-paid (fee-recovery), so the client shows this fee before the user confirms and reserves it in
   "Send Max". Mirrors the exact estimator the send routes charge with, so the quoted number matches
   what is billed. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { estimateArcNetworkFeeMicros } from "@/lib/sponsor/networkFees";
import { MAX_BATCH_RECIPIENTS } from "@/lib/payments/batchLimits";

export async function GET(request: Request) {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = Number(new URL(request.url).searchParams.get("recipients") || "1");
    const transfers = Number.isInteger(raw) && raw > 0 && raw <= MAX_BATCH_RECIPIENTS ? raw : 1;

    const fee = await estimateArcNetworkFeeMicros(transfers);
    return NextResponse.json({
        recipients: transfers,
        feeUsdc: fee.feeUsdc,
        feeMicros: fee.feeMicros.toString(),
        fallback: fee.fallback,
    });
}
