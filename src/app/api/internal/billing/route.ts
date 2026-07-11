/* API route for internal webhook and cron execution of merchant premium billing */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";
import { verifyWebhookSignature } from "@/lib/webhooks";

/*
 * GET handler: Cron execution to synchronize billing state and downgrade delinquent merchants.
 */
export async function GET(request: Request) {
    try {
        /* Authenticate with the external keeper secret or Vercel's CRON_SECRET, matching the other
           cron routes. Without this, anyone could trigger the premium downgrade sweep. */
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

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Database not available" }, { status: 500 });
        }

        /* 1. Fetch all premium merchants.
           tier is a TEXT column ('FREE' | 'PREMIUM') since migration 20260611000000; the prior
           `.eq("tier", 1)` matched zero rows, so delinquent merchants were never downgraded. */
        const { data: premiumMerchants, error: merchantError } = await supabaseAdmin
            .from("merchants")
            .select("wallet_address")
            .eq("tier", "PREMIUM");

        if (merchantError) {
            console.error("Failed to query premium merchants:", merchantError);
            return NextResponse.json({ error: "Database error fetching merchants" }, { status: 500 });
        }

        const nowStr = new Date().toISOString();
        const results = [];

        /* 2. For each premium merchant, check if they have an active subscription to the admin wallet */
        for (const merchant of (premiumMerchants || [])) {
            const wallet = merchant.wallet_address.toLowerCase();

            /* Premium subscriptions (merchant -> SubScript) are stored by activate_premium_merchant
               with merchant_address = the MERCHANT's own wallet and kind = 'PREMIUM' (subscriber is
               left null on that path). The prior query looked them up as merchant_address = the admin
               wallet / subscriber = the merchant, which matched zero rows and downgraded every paying
               merchant. Match on the merchant's own row instead. */
            /* subscriptions is keyed by subscription_id, so a merchant can hold more than one
               PREMIUM row (e.g. a re-subscribe with a new subId). Order by the latest next_billing
               and take one so maybeSingle() can't error on multiple rows and skip a legitimate
               downgrade — the most recent authorization is the one that keeps them premium. */
            const { data: sub, error: subError } = await supabaseAdmin
                .from("subscriptions")
                .select("status, next_billing_date")
                .eq("kind", "PREMIUM")
                .eq("merchant_address", wallet)
                .in("status", ["ACTIVE", "PAST_DUE"])
                .order("next_billing_date", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (subError) {
                console.error(`Error querying subscription for merchant ${wallet}:`, subError);
                continue;
            }

            /* If no active subscription is found, or if next_billing_date has passed by more than 3 days (grace period), downgrade to FREE */
            let shouldDowngrade = false;
            let reason = "";

            if (!sub) {
                shouldDowngrade = true;
                reason = "No active premium subscription record found";
            } else {
                const nextBilling = new Date(sub.next_billing_date);
                const graceExpiry = new Date(nextBilling.getTime() + 3 * 24 * 60 * 60 * 1000); /* 3 days grace */
                
                if (new Date() > graceExpiry) {
                    shouldDowngrade = true;
                    reason = `Subscription grace period expired. Next billing was ${sub.next_billing_date}`;
                }
            }

            if (shouldDowngrade) {
                const { error: updateError } = await supabaseAdmin
                    .from("merchants")
                    .update({
                        tier: "FREE",
                        updated_at: new Date().toISOString()
                    })
                    .eq("wallet_address", wallet);

                if (updateError) {
                    console.error(`Failed to downgrade merchant ${wallet}:`, updateError);
                } else {
                    console.log(`[Billing Cron] Downgraded merchant ${wallet} to FREE. Reason: ${reason}`);
                    results.push({ wallet, status: "DOWNGRADED", reason });
                }
            } else {
                results.push({ wallet, status: "OK" });
            }
        }

        return NextResponse.json({ success: true, processed: results.length, results }, { status: 200 });

    } catch (err: any) {
        console.error("Cron billing sync exception:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

/*
 * POST handler: Webhook receiver that processes SubScript protocol events.
 */
export async function POST(request: Request) {
    try {
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Database not available" }, { status: 500 });
        }

        /* 1. Enforce signature verification to authenticate calls.
           Uses the shared verifyWebhookSignature helper: constant-time (timingSafeEqual)
           comparison, rejection of an empty/unconfigured secret, and a 5-minute replay window. */
        const signatureHeader = request.headers.get("x-subscript-signature");
        if (!signatureHeader) {
            return NextResponse.json({ error: "Unauthorized: Missing signature" }, { status: 400 });
        }

        const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";
        if (!secret) {
            console.error("[internal/billing] SUBSCRIPT_WEBHOOK_SECRET is not configured");
            return NextResponse.json({ error: "Internal Server Error: Webhook secret not configured" }, { status: 500 });
        }

        const rawBody = await request.text();
        if (!verifyWebhookSignature(rawBody, signatureHeader, secret, 300)) {
            return NextResponse.json({ error: "Unauthorized: Signature verification failed" }, { status: 401 });
        }

        /* 2. Parse payload */
        const body = JSON.parse(rawBody);
        const { event, data } = body;

        if (!event || !data) {
            return NextResponse.json({ error: "Bad Request: Missing event or data" }, { status: 400 });
        }

        /* Check if the recipient of this subscription is the SubScript Admin Wallet */
        const recipient = (data.merchant || "").toLowerCase();
        if (recipient !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
            /* Ignore events for standard merchant subscriptions */
            return NextResponse.json({ success: true, message: "Ignored standard subscription event" });
        }

        const subscriber = (data.subscriber || "").toLowerCase();
        if (!subscriber) {
            return NextResponse.json({ error: "Bad Request: Missing subscriber address" }, { status: 400 });
        }

        /* The signed raw body is immutable: replaying a captured request necessarily produces the
           same digest. Claim it before changing entitlement state so an older success event cannot
           be replayed after a cancellation/failure within the signature tolerance window. */
        const executionKey = `internal-billing:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
        const { error: claimError } = await supabaseAdmin
            .from("idempotency_keys")
            .insert({
                execution_key: executionKey,
                status: "PROCESSING",
                response_payload: null,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            });
        if (claimError?.code === "23505") {
            return NextResponse.json({ success: true, duplicate: true, message: "Event already processed" });
        }
        if (claimError) {
            console.error("[internal/billing] Failed to claim webhook event:", claimError.message);
            return NextResponse.json({ error: "Database idempotency check failed" }, { status: 500 });
        }

        /* 3. Execute state transitions based on subscription event type */
        let newTier: number = 0;
        let actionMessage = "";

        if (
            event === "subscription.created" || 
            event === "payment.executed" || 
            event === "subscription.payment.executed"
        ) {
            newTier = 1;
            actionMessage = "Upgraded merchant to PREMIUM";
        } else if (
            event === "subscription.cancelled" || 
            event === "subscription.expired" || 
            event === "subscription.payment.failed"
        ) {
            newTier = 0;
            actionMessage = "Downgraded merchant to FREE";
        } else {
            /* Ignore unhandled events but return 200 */
            await supabaseAdmin.from("idempotency_keys").update({
                status: "COMPLETED",
                response_payload: { event, ignored: true },
                updated_at: new Date().toISOString(),
            }).eq("execution_key", executionKey);
            return NextResponse.json({ success: true, message: `No action taken for event: ${event}` });
        }

        /* 4. Update the database record */
        const { error: updateError } = await supabaseAdmin
            .from("merchants")
            .update({
                tier: newTier === 1 ? "PREMIUM" : "FREE",
                updated_at: new Date().toISOString()
            })
            .eq("wallet_address", subscriber);

        if (updateError) {
            await supabaseAdmin.from("idempotency_keys").delete().eq("execution_key", executionKey);
            console.error(`Failed to update tier for merchant ${subscriber}:`, updateError);
            return NextResponse.json({ error: "Database update failed" }, { status: 500 });
        }

        await supabaseAdmin
            .from("idempotency_keys")
            .update({
                status: "COMPLETED",
                response_payload: { event, subscriber, tier: newTier },
                updated_at: new Date().toISOString(),
            })
            .eq("execution_key", executionKey);

        console.log(`[Billing Webhook] ${actionMessage} for ${subscriber}. Event: ${event}`);

        return NextResponse.json({ 
            success: true, 
            message: `Processed event ${event} successfully`,
            merchant: subscriber,
            tier: newTier
        });

    } catch (err: any) {
        console.error("Webhook processing exception:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
