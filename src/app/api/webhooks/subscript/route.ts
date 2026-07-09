import { after, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { triggerExitSurvey } from "@/lib/payments/email";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";

let supabaseClient: any = null;

function getSupabaseClient() {
    if (!supabaseClient) {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Supabase configuration missing: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be defined in environment");
        }
        supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    }
    return supabaseClient;
}

export async function POST(request: Request) {
    const supabase = getSupabaseClient();

    try {
        /* 1. Enforce strict cryptographic HMAC-SHA256 signature verification */
        const signatureHeader = request.headers.get("x-subscript-signature");
        if (!signatureHeader) {
            return NextResponse.json({ error: "Unauthorized: Missing signature header" }, { status: 400 });
        }

        const match = signatureHeader.match(/t=(\d+),v1=([a-f0-9]+)/);
        if (!match) {
            return NextResponse.json({ error: "Unauthorized: Invalid signature format" }, { status: 400 });
        }

        const t = match[1];
        const v1 = match[2];

        /* Replay attack prevention: check timestamp age (max 5 minutes) */
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(t, 10)) > 300) {
            return NextResponse.json({ error: "Unauthorized: Signature expired" }, { status: 400 });
        }

        /* Retrieve raw body text to maintain exact byte alignment for hashing */
        const rawBody = await request.text();
        const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;
        if (!secret) {
            console.error("[Webhook Configuration Error] SUBSCRIPT_WEBHOOK_SECRET is not configured.");
            return NextResponse.json({ error: "Internal Server Error: Webhook secret is not configured" }, { status: 500 });
        }

        const signaturePayload = `${t}.${rawBody}`;
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(signaturePayload);
        const computedSignature = hmac.digest("hex");

        const receivedBuffer = Buffer.from(v1, "hex");
        const expectedBuffer = Buffer.from(computedSignature, "hex");
        if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
            return NextResponse.json({ error: "Unauthorized: Signature mismatch" }, { status: 401 });
        }

        /* 2. Parse the body object */
        const body = JSON.parse(rawBody);
        const { event, data } = body;

        if (!event || !data) {
            return NextResponse.json({ error: "Bad Request: Missing event or data payload" }, { status: 400 });
        }

        const txHash = data.txHash || data.transactionHash;
        if (!txHash) {
            return NextResponse.json({ error: "Bad Request: Missing unique txHash" }, { status: 400 });
        }

        /* 3. Extract the merchant identity. */
        const merchantAddress = (data.merchant || "").toLowerCase();
        if (!merchantAddress) {
            return NextResponse.json({ error: "Bad Request: Missing merchant address in data payload" }, { status: 400 });
        }

        /* 4. Replay short-circuit. The durable webhook_events row (unique on tx_hash) is the COMMIT
           MARKER for a fully-processed event and is written LAST (step 8), not here. So its presence
           means a previous delivery already completed every write below; skip re-processing. */
        const { data: priorEvent } = await supabase
            .from("webhook_events")
            .select("id")
            .eq("tx_hash", txHash)
            .maybeSingle();
        if (priorEvent) {
            console.log(`[Webhook Replay Protected] tx_hash ${txHash} already processed. Ignoring event.`);
            return NextResponse.json({ success: true, message: "Duplicate transaction processed" });
        }

        /* 5. Ensure the merchant identity exists (idempotent — keyed by wallet_address). */
        const { error: merchantError } = await supabase
            .from("merchants")
            .upsert({
                wallet_address: merchantAddress,
            }, { onConflict: "wallet_address" });

        if (merchantError) {
            console.error("[Webhook Database Error] Merchant upsert failed:", merchantError);
            throw new Error(`Failed to sync merchant: ${merchantError.message}`);
        }

        /* 6. Parse and upsert subscription details (idempotent — keyed by subscription_id). */
        const subIdStr = data.subscriptionId || data.subId;
        const cleanSubId = subIdStr ? parseInt(String(subIdStr).replace(/^sub_/, ""), 10) : null;
        let exitSurveySubId: number | null = null;

        if (cleanSubId !== null && !isNaN(cleanSubId)) {
            /* amount_cap_usdc is integer micro-USDC everywhere else (mirror.ts writes micros; the
               billing crons/driftHealer read it as amountUsdcMicros). The canonical webhook payload
               carries `amount_usdc_micros` (integer) alongside a human `amount` (decimal). Prefer the
               integer micros field; only fall back to converting the decimal (× 1e6) for legacy
               senders. Writing parseFloat(decimal) straight into this column was 1e6× too small. */
            const microsRaw = data.amount_usdc_micros ?? data.amountUsdcMicros;
            let amountMicros = 0;
            if (microsRaw !== undefined && microsRaw !== null && /^\d+$/.test(String(microsRaw).trim())) {
                amountMicros = parseInt(String(microsRaw).trim(), 10);
            } else if (data.amount !== undefined && data.amount !== null && data.amount !== "") {
                const decimal = parseFloat(String(data.amount));
                amountMicros = Number.isFinite(decimal) ? Math.round(decimal * 1_000_000) : 0;
            }
            const period = data.period ? parseInt(String(data.period), 10) : 0;
            /* `last_settlement_timestamp` is when THIS payment settled (now), not the next due date.
               A BEFORE INSERT/UPDATE trigger (update_subscription_next_billing_date) derives
               next_billing_date as last_settlement_timestamp + billing_interval_seconds, so storing a
               future value here would push the renewal a full period late. We also set next_billing_date
               explicitly so it's correct even if that trigger isn't deployed. Matches subscriptions/mirror.ts. */
            const nowIso = new Date().toISOString();
            const nextBillingDate = new Date(Date.now() + period * 1000).toISOString();

            let status = "ACTIVE";
            if (event === "subscription.cancelled" || event === "subscription.expired") {
                status = "CANCELED";
            } else if (event === "subscription.payment.failed") {
                status = "FAILED";
            }

            /* Classify by recipient: subscriptions paid to the SubScript treasury are PREMIUM
               (merchant -> SubScript); everything else is a CUSTOMER plan (customer -> merchant)
               which the Premium billing cron must ignore. */
            const kind = merchantAddress === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()
                ? "PREMIUM"
                : "CUSTOMER";

            const { error: subError } = await supabase
                .from("subscriptions")
                .upsert({
                    subscription_id: cleanSubId,
                    merchant_address: merchantAddress,
                    subscriber: data.subscriber ? String(data.subscriber).toLowerCase() : null,
                    current_nonce: data.currentNonce !== undefined ? parseInt(String(data.currentNonce), 10) : 0,
                    last_settlement_timestamp: nowIso,
                    next_billing_date: nextBillingDate,
                    billing_interval_seconds: period,
                    amount_cap_usdc: amountMicros,
                    payment_tx_hash: data.nextCommitment || data.nullifierHash || null,
                    status: status,
                    kind,
                    updated_at: new Date().toISOString()
                }, { onConflict: "subscription_id" });

            if (subError) {
                console.error("[Webhook Database Error] Subscription upsert failed:", subError);
                throw new Error(`Failed to sync subscription details: ${subError.message}`);
            }

            if (status === "CANCELED" || status === "FAILED") {
                /* Defer the (non-idempotent) survey email until the event is durably committed in
                   step 8, so a retried run never sends it twice. */
                exitSurveySubId = cleanSubId;
            }
        }

        /* 6. Premium merchantPayoutDestination configurations retrieval */
        const { data: merchantInfo, error: fetchError } = await supabase
            .from("merchants")
            .select("tier, payout_destination")
            .eq("wallet_address", merchantAddress)
            .single();

        if (fetchError) {
            console.warn(`[Webhook Warning] Could not fetch merchant status for ${merchantAddress}:`, fetchError);
        } else if (merchantInfo && merchantInfo.tier === "PREMIUM") {
            console.log(`[Premium Rerouting Active] Payout mapping fetched for ${merchantAddress}:`, {
                tier: merchantInfo.tier,
                payoutDestination: merchantInfo.payout_destination || "Default connected address"
            });
            /* Execute premium alerts or configure automated payout cycles here */
        }

        /* 8. Commit marker: write the durable, replay-protecting webhook_events row LAST. Because
           every write above is an idempotent upsert, a failure before this point commits no event —
           the sender's redelivery simply re-runs the upserts and reaches here once. The unique
           tx_hash also resolves the concurrent-delivery race: the loser gets 23505 and returns. */
        const { error: eventError } = await supabase
            .from("webhook_events")
            .insert({
                tx_hash: txHash,
                event_type: event,
                payload: body
            });

        if (eventError) {
            if (eventError.code === "23505") { /* unique_violation — a concurrent delivery committed first */
                console.log(`[Webhook Replay Protected] Concurrent delivery already committed tx_hash ${txHash}.`);
                return NextResponse.json({ success: true, message: "Duplicate transaction processed" });
            }
            console.error("[Webhook Database Error] Event commit insert failed:", eventError);
            throw new Error(`Failed to log webhook event: ${eventError.message}`);
        }

        /* 9. Non-idempotent side effects run only after the event is durably committed, so a retry of
           a failed run never sends duplicate exit-survey emails. Deferred via after() so the send is
           tied to the request lifecycle and not dropped when the serverless function returns. */
        if (exitSurveySubId !== null) {
            const surveySubId = exitSurveySubId;
            after(() => {
                triggerExitSurvey(merchantAddress, surveySubId, 0).catch(err => {
                    console.error("Failed to trigger exit survey:", err);
                });
            });
        }

        return NextResponse.json({ success: true, message: "Webhook processed and synced to Supabase" });

    } catch (err: any) {
        /* No manual rollback: the durable webhook_events commit marker is written last, so a failure
           here means it was never committed. Every prior write is an idempotent upsert keyed by a
           natural key, so the sender's redelivery safely reprocesses and commits exactly once. */
        console.error("[Webhook Exception] Processing failed before commit; safe to retry.", err);
        return NextResponse.json({ error: "Database transaction failed", details: err.message }, { status: 500 });
    }
}
