import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reconcile } from "@/lib/payments/reconciliationWorker";
import { processPaymentLinkVerificationJobs } from "@/lib/payments/paymentLinkVerificationWorker";
import { healSubscriptionDrift } from "@/lib/subscriptions/driftHealer";
import { deliverPendingWebhookOutboxEvents } from "@/lib/webhookOutbox";
import { processPaymentReconciliationEvents } from "@/lib/payments/reconciliationRetry";

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

        /* These queues must make progress without a payer revisiting checkout or
           an operator clicking the admin retry button. Each worker claims rows
           atomically, so this remains safe when an external scheduler overlaps. */
        const [webhookOutbox, paymentOperations] = await Promise.all([
            deliverPendingWebhookOutboxEvents(supabase, 100).catch((error: any) => ({
                error: error?.message || "webhook outbox drain failed",
            })),
            processPaymentReconciliationEvents(50).catch((error: any) => ({
                error: error?.message || "payment operations drain failed",
            })),
        ]);

        /* Drain durable hosted-checkout verifications before the broader sweep.
           The DB claim uses SKIP LOCKED leases, so overlapping keepers are safe. */
        let paymentLinkVerification: Awaited<ReturnType<typeof processPaymentLinkVerificationJobs>> | { error: string };
        try {
            paymentLinkVerification = await processPaymentLinkVerificationJobs(supabase, 5);
        } catch (verificationError: any) {
            console.error("[reconcile] Payment-link verification worker failed:", verificationError?.message || verificationError);
            paymentLinkVerification = { error: verificationError?.message || "payment-link verification worker failed" };
        }

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

        const workerHealthy = "error" in paymentLinkVerification
            ? false
            : paymentLinkVerification.success;
        return NextResponse.json(
            { ...result, paymentLinkVerification, webhookOutbox, paymentOperations, drift },
            {
                status: result.success
                    && workerHealthy
                    && !("error" in webhookOutbox)
                    && !("error" in paymentOperations)
                    /* processPaymentReconciliationEvents returns { success:false } (not { error })
                       when individual events fail; treat that as unhealthy so the cron surfaces it. */
                    && !("success" in paymentOperations && paymentOperations.success === false)
                    ? 200
                    : 500,
            },
        );

    } catch (error: any) {
        console.error("Premium reconciliation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
export async function GET(request: Request) {
    return POST(request);
}
