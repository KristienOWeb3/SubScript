import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reconcile } from "@/lib/payments/reconciliationWorker";
import { healSubscriptionDrift } from "@/lib/subscriptions/driftHealer";

/* Payment reconciliation + subscription drift healing both read the chain per row — give
   the combined pass generous headroom. */
export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        /* Accept the external keeper secret or Vercel's CRON_SECRET (Vercel cron invokes this
           path with `Authorization: Bearer ${CRON_SECRET}`); either may be configured. */
        const authHeader = request.headers.get("Authorization");
        const keeperSecret = process.env.KEEPER_SECRET;
        const cronSecret = process.env.CRON_SECRET;
        if (!keeperSecret && !cronSecret) {
            return NextResponse.json({ error: "Internal Server Error: KEEPER_SECRET or CRON_SECRET must be configured" }, { status: 500 });
        }
        const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const authorized = !!presented && ((!!keeperSecret && presented === keeperSecret) || (!!cronSecret && presented === cronSecret));
        if (!authorized) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const result = await reconcile(supabase, 300);

        /* Heal on-chain ↔ DB subscription drift (permissionless executes, explorer cancels,
           authorizations left live behind a DB cancel). Best-effort: a drift failure must not
           mask the payment-reconcile result this route primarily exists for. */
        let drift: Awaited<ReturnType<typeof healSubscriptionDrift>> | { error: string };
        try {
            drift = await healSubscriptionDrift(supabase, 60);
        } catch (driftErr: any) {
            console.error("[reconcile] drift healer failed:", driftErr?.message || driftErr);
            drift = { error: driftErr?.message || "drift healer failed" };
        }

        return NextResponse.json({ ...result, drift }, { status: result.success ? 200 : 500 });

    } catch (error: any) {
        console.error("Premium reconciliation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
export async function GET(request: Request) {
    return POST(request);
}
