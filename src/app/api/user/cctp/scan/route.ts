import { NextRequest, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { scanCrossChainBalances } from "@/lib/cctp/crossChainScanner";
import { sweepAndBridge } from "@/lib/cctp/autoBridge";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const sessionWallet = await getSessionWallet(req.headers);
    const url = new URL(req.url);
    const paramAddress = url.searchParams.get("address");

    const targetWallet = (sessionWallet || paramAddress || "").trim().toLowerCase();
    if (!targetWallet || !/^0x[a-fA-F0-9]{40}$/.test(targetWallet)) {
      return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
    }

    // Proactively trigger a sweep pass on scan
    void sweepAndBridge().catch(() => undefined);

    const result = await scanCrossChainBalances(targetWallet);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("[api/user/cctp/scan] error:", error);
    return NextResponse.json({ error: error?.message || "Failed to scan cross-chain balances" }, { status: 500 });
  }
}
