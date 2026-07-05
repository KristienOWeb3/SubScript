import { NextResponse } from "next/server";
import { runLegacyWalletMigration } from "@/lib/ops/migrateWallets";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json(
                { error: "Internal Server Error: Keeper secret key configuration missing" },
                { status: 500 }
            );
        }

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const runMode = body.run === true;

        const result = await runLegacyWalletMigration({
            isDryRun: !runMode,
        });

        return NextResponse.json({
            success: result.success,
            migratedCount: result.migratedCount,
            logs: result.logs,
        });
    } catch (err: any) {
        console.error("Admin legacy wallet migration endpoint failed:", err);
        return NextResponse.json(
            { error: err.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
