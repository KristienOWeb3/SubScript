import { NextResponse } from "next/server";

export async function POST() {
    return NextResponse.json({
        error: "Simulated top-ups are disabled. Commit real USDC through /api/user/vault/commit.",
        code: "ONCHAIN_COMMIT_REQUIRED",
    }, { status: 410 });
}
