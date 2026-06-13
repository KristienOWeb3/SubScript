/* API route for internal webhook and cron execution of merchant premium billing */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";

/*
 * GET handler: Cron execution to synchronize billing state and downgrade delinquent merchants.
 */
export async function GET(request: Request) {
    try {
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Database not available" }, { status: 500 });
        }

        /* 1. Fetch all premium merchants */
        const { data: premiumMerchants, error: merchantError } = await supabaseAdmin
            .from("merchants")
            .select("wallet_address")
            .eq("tier", 1);

        if (merchantError) {
            console.error("Failed to query premium merchants:", merchantError);
            return NextResponse.json({ error: "Database error fetching merchants" }, { status: 500 });
        }

        const nowStr = new Date().toISOString();
        const results = [];

        /* 2. For each premium merchant, check if they have an active subscription to the admin wallet */
        for (const merchant of (premiumMerchants || [])) {
            const wallet = merchant.wallet_address.toLowerCase();

            /* Check if there exists an active subscription where subscriber is the merchant and merchant_address is the Admin Wallet */
            const { data: sub, error: subError } = await supabaseAdmin
                .from("subscriptions")
                .select("status, next_billing_date")
                .eq("merchant_address", PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase())
                .eq("subscriber", wallet)
                .in("status", ["ACTIVE", "PAST_DUE"])
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

        /* 1. Enforce signature verification to authenticate calls */
        const signatureHeader = request.headers.get("x-subscript-signature");
        if (!signatureHeader) {
            return NextResponse.json({ error: "Unauthorized: Missing signature" }, { status: 400 });
        }

        const match = signatureHeader.match(/t=(\d+),v1=([a-f0-9]+)/);
        if (!match) {
            return NextResponse.json({ error: "Unauthorized: Invalid signature format" }, { status: 400 });
        }

        const t = match[1];
        const v1 = match[2];

        /* Replay attack prevention: max 5 minutes */
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(t, 10)) > 300) {
            return NextResponse.json({ error: "Unauthorized: Expired signature" }, { status: 400 });
        }

        const rawBody = await request.text();
        const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";

        const signaturePayload = `${t}.${rawBody}`;
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(signaturePayload);
        const computedSignature = hmac.digest("hex");

        if (computedSignature !== v1) {
            return NextResponse.json({ error: "Unauthorized: Signature mismatch" }, { status: 401 });
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
            console.error(`Failed to update tier for merchant ${subscriber}:`, updateError);
            return NextResponse.json({ error: "Database update failed" }, { status: 500 });
        }

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
