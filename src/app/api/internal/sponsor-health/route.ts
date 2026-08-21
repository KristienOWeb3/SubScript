/*
 * Sponsor wallet health check, for an external scheduler.
 *
 * Read the gas sponsor wallet and mail platform admins if, and only if, something changed. All of
 * the de-noising (transition, cooldown, recovery) lives in lib/sponsor/gasAlerts; this route is
 * only the trigger, so it stays safe to call by hand or twice by accident.
 *
 * Cadence: every 15 minutes, from .github/workflows/sponsor-health.yml. Vercel Hobby crons are
 * daily-only (the plan limit is on frequency, not job count), and up to 24 hours of silence while
 * every sponsored payment fails closed is the exact bug this endpoint exists to fix. So it runs
 * from GitHub Actions alongside the other sub-daily keepers. See docs/external-crons.md.
 *
 * Auth: Bearer CRON_SECRET | KEEPER_SECRET, the same constant-time check every other internal and
 * keeper route in this repo uses. Nothing here is a money movement, but the response describes the
 * platform's gas position, which is not public.
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runSponsorWalletHealthCheck } from "@/lib/sponsor/gasAlerts";

/* One read, one or two small upserts, and at most a handful of emails. */
export const maxDuration = 60;

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));

    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

export async function GET(request: Request) {
    if (!process.env.KEEPER_SECRET && !process.env.CRON_SECRET) {
        return NextResponse.json(
            { error: "Internal Server Error: KEEPER_SECRET or CRON_SECRET must be configured" },
            { status: 500 },
        );
    }
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await runSponsorWalletHealthCheck();
        /* 200 even when the wallet is empty. An empty wallet is a finding this route reported
           correctly, not a failure of the route, and a red scheduler run for a condition that is
           already being emailed teaches people to ignore red scheduler runs. The response body
           carries no recipient addresses, only counts. */
        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        /* runSponsorWalletHealthCheck is written not to throw. If it somehow does, that IS a bug
           in the alerting path, so let the scheduler go red for it. */
        console.error("[internal/sponsor-health] check failed:", error?.message || error);
        return NextResponse.json({ error: "Sponsor wallet health check failed" }, { status: 500 });
    }
}
