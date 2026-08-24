import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { fetchArcUsdcDeposits } from "@/lib/deposits/arcDeposits";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const deposits = await fetchArcUsdcDeposits(wallet);

        return NextResponse.json({
            success: true,
            deposits,
            count: deposits.length,
        });
    } catch (error: any) {
        console.error("[api/user/deposits] error:", error);
        return NextResponse.json({ error: error?.message || "Failed to fetch deposits" }, { status: 500 });
    }
}
