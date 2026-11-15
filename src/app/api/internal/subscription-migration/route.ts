/* Operator-run migration of live customer subscriptions from legacy PSA deployments to the active
 * one. See src/lib/subscriptions/contractMigration.ts for what it does and what it skips.
 *
 * POST /api/internal/subscription-migration   { "dryRun": true, "limit": 25 }
 * Authorization: Bearer <KEEPER_SECRET or CRON_SECRET>
 *
 * Dry run is the default and signs nothing. Pass "dryRun": false explicitly to move money-bearing
 * authorizations. It is deliberately NOT on a schedule: an operator runs it after the cutover
 * checklist in docs/mainnet/README.md, reads the dry-run report, then runs it for real.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";

import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { migrateLegacySubscriptions } from "@/lib/subscriptions/contractMigration";

export const maxDuration = 300;

function isAuthorized(request: Request) {
    const presented = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
    const configured = [process.env.KEEPER_SECRET, process.env.CRON_SECRET].filter((v): v is string => Boolean(v));
    if (!presented || configured.length === 0) return false;
    const digest = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest();
    return configured.some((value) => crypto.timingSafeEqual(digest(presented), digest(value)));
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        assertFinancialNetworkReady();
    } catch (networkError) {
        console.error("[subscription-migration] financial network is not ready:", networkError);
        return NextResponse.json({ error: "Financial network configuration is incomplete." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    /* Only an explicit boolean false runs for real. Anything else (missing, "false", 0) is a dry run. */
    const dryRun = body?.dryRun !== false;
    const limit = Number.isFinite(Number(body?.limit)) ? Number(body.limit) : 25;
    try {
        const report = await migrateLegacySubscriptions({ dryRun, limit });
        const failed = report.outcomes.filter((outcome) => outcome.action === "FAILED").length;
        return NextResponse.json({ success: failed === 0, ...report }, { status: failed === 0 ? 200 : 207 });
    } catch (error) {
        console.error("[subscription-migration] run failed:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Migration failed" }, { status: 500 });
    }
}
