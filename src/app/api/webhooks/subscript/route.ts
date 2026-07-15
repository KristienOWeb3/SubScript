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

        /* Replay protection is a text-equality check on tx_hash, so the identifier must be
           structurally valid and case-normalized — otherwise re-sending the same signed event
           with different hash casing (0xAB… vs 0xab…) would bypass deduplication. */
        const rawTxHash = data.txHash || data.transactionHash;
        if (typeof rawTxHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawTxHash.trim())) {
            return NextResponse.json({ error: "Bad Request: Missing or malformed txHash" }, { status: 400 });
        }
        const txHash = rawTxHash.trim().toLowerCase();

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

        /* 5. Parse and merge subscription details (idempotent — keyed by subscription_id). */
        const subIdStr = data.subscriptionId || data.subId;
        const cleanSubId = subIdStr ? parseInt(String(subIdStr).replace(/^sub_/, ""), 10) : null;
        let exitSurveySubId: number | null = null;

        if (cleanSubId !== null && !isNaN(cleanSubId)) {
            const incomingSubscriber = data.subscriber ? String(data.subscriber).toLowerCase() : null;
            const incomingKind = merchantAddress === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()
                ? "PREMIUM"
                : "CUSTOMER";
            const { data: existingSubscription, error: existingSubscriptionError } = await supabase
                .from("subscriptions")
                .select("merchant_address,subscriber,current_nonce,last_settlement_timestamp,next_billing_date,billing_interval_seconds,amount_cap_usdc,payment_tx_hash,status,kind,tier")
                .eq("subscription_id", cleanSubId)
                .maybeSingle();
            if (existingSubscriptionError) {
                throw new Error(`Failed to load existing subscription: ${existingSubscriptionError.message}`);
            }

            /* Old protocol deliveries used the treasury recipient as the row owner and could
               overwrite an already-canonical Premium row when ids collided. Never let a CUSTOMER
               delivery rewrite Premium entitlement identity. */
            if (existingSubscription?.kind === "PREMIUM" && incomingKind !== "PREMIUM") {
                console.warn(`[Webhook Obsolete Identity] Ignoring CUSTOMER event for canonical premium subscription ${cleanSubId}.`);
                return NextResponse.json({ success: true, message: "Obsolete subscription identity ignored" });
            }

            const canonicalOwner = incomingKind === "PREMIUM"
                ? (incomingSubscriber || existingSubscription?.subscriber || existingSubscription?.merchant_address)
                : merchantAddress;
            if (!canonicalOwner) {
                return NextResponse.json({ error: "Bad Request: Missing premium subscriber identity" }, { status: 400 });
            }

            /* Ensure the canonical row owner exists before the subscription FK write. */
            const { error: merchantError } = await supabase
                .from("merchants")
                .upsert({ wallet_address: canonicalOwner }, { onConflict: "wallet_address" });
            if (merchantError) {
                throw new Error(`Failed to sync merchant: ${merchantError.message}`);
            }

            /* amount_cap_usdc is integer micro-USDC everywhere else (mirror.ts writes micros; the
               billing crons/driftHealer read it as amountUsdcMicros). The canonical webhook payload
               carries `amount_usdc_micros` (integer) alongside a human `amount` (decimal). Prefer the
               integer micros field; only fall back to converting the decimal (× 1e6) for legacy
               senders. Writing parseFloat(decimal) straight into this column was 1e6× too small. */
            const microsRaw = data.amount_usdc_micros ?? data.amountUsdcMicros;
            let amountMicros: number | string = existingSubscription?.amount_cap_usdc ?? 0;
            if (microsRaw !== undefined && microsRaw !== null && /^\d+$/.test(String(microsRaw).trim())) {
                amountMicros = parseInt(String(microsRaw).trim(), 10);
            } else if (data.amount !== undefined && data.amount !== null && data.amount !== "") {
                const decimal = parseFloat(String(data.amount));
                amountMicros = Number.isFinite(decimal) ? Math.round(decimal * 1_000_000) : 0;
            }
            const period = data.period !== undefined && data.period !== null && data.period !== ""
                ? parseInt(String(data.period), 10)
                : Number(existingSubscription?.billing_interval_seconds || 0);
            /* `last_settlement_timestamp` is when THIS payment settled (now), not the next due date.
               A BEFORE INSERT/UPDATE trigger (update_subscription_next_billing_date) derives
               next_billing_date as last_settlement_timestamp + billing_interval_seconds, so storing a
               future value here would push the renewal a full period late. We also set next_billing_date
               explicitly so it's correct even if that trigger isn't deployed. Matches subscriptions/mirror.ts. */
            const nowIso = new Date().toISOString();
            const settlesPayment = ["subscription.created", "subscription.renewed", "payment.executed", "subscription.payment.executed"].includes(event);
            const lastSettlementTimestamp = settlesPayment
                ? nowIso
                : existingSubscription?.last_settlement_timestamp ?? null;
            const nextBillingDate = settlesPayment && period > 0
                ? new Date(Date.now() + period * 1000).toISOString()
                : existingSubscription?.next_billing_date ?? null;

            let status = "ACTIVE";
            if (event === "subscription.cancelled" || event === "subscription.expired") {
                status = "CANCELED";
            } else if (event === "subscription.payment.failed") {
                status = "FAILED";
            }

            const { error: subError } = await supabase
                .from("subscriptions")
                .upsert({
                    subscription_id: cleanSubId,
                    merchant_address: canonicalOwner,
                    subscriber: incomingSubscriber || existingSubscription?.subscriber || (incomingKind === "PREMIUM" ? canonicalOwner : null),
                    current_nonce: data.currentNonce !== undefined
                        ? parseInt(String(data.currentNonce), 10)
                        : Number(existingSubscription?.current_nonce || 0),
                    last_settlement_timestamp: lastSettlementTimestamp,
                    next_billing_date: nextBillingDate,
                    billing_interval_seconds: period,
                    amount_cap_usdc: amountMicros,
                    payment_tx_hash: data.nextCommitment || data.nullifierHash || existingSubscription?.payment_tx_hash || null,
                    status: status,
                    kind: incomingKind,
                    tier: incomingKind === "PREMIUM" ? 1 : Number(existingSubscription?.tier || 0),
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
