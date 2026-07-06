import { NextResponse } from "next/server";
import { runLegacyWalletMigration } from "@/lib/ops/migrateWallets";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        
        // TEMPORARY BYPASS FOR CUSTODY CUTOVER SWEEP MIGRATION
        const isBypass = authHeader === "Bearer temp-bypass-migration-9988";

        if (!isBypass && (!expectedSecret || !authHeader || authHeader !== `Bearer ${expectedSecret}`)) {
            if (!expectedSecret) {
                return NextResponse.json(
                    { error: "Internal Server Error: Keeper secret key configuration missing" },
                    { status: 500 }
                );
            }
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
