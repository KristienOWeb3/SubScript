import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { triggerExitSurvey } from "@/lib/payments/email";

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
    let eventIdInserted: string | null = null;
    
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
        const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";

        const signaturePayload = `${t}.${rawBody}`;
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(signaturePayload);
        const computedSignature = hmac.digest("hex");

        if (computedSignature !== v1) {
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

        /* 3. Database transaction execution & replay protection */
        /* Direct insertion into webhook_events acts as a concurrent lock on the unique tx_hash */
        const { data: eventLog, error: eventError } = await supabase
            .from("webhook_events")
            .insert({
                tx_hash: txHash,
                event_type: event,
                payload: body
            })
            .select("id")
            .single();

        if (eventError) {
            if (eventError.code === "23505") { /* unique_violation */
                console.log(`[Webhook Replay Protected] Uniqueness clash on tx_hash ${txHash}. Ignoring event.`);
                return NextResponse.json({ success: true, message: "Duplicate transaction processed" });
            }
            console.error("[Webhook Database Error] Log insert failed:", eventError);
            throw new Error(`Failed to log webhook event: ${eventError.message}`);
        }

        eventIdInserted = eventLog.id;

        /* Extract merchant EVM wallet address and format */
        const merchantAddress = (data.merchant || "").toLowerCase();
        if (!merchantAddress) {
            throw new Error("Missing merchant address in data payload");
        }

        /* 4. Ensure Merchant wallet identity exists to prevent Foreign Key constraints failures */
        const { error: merchantError } = await supabase
            .from("merchants")
            .upsert({
                wallet_address: merchantAddress,
            }, { onConflict: "wallet_address" });

        if (merchantError) {
            console.error("[Webhook Database Error] Merchant upsert failed:", merchantError);
            throw new Error(`Failed to sync merchant: ${merchantError.message}`);
        }

        /* 5. Parse and upsert subscription details */
        const subIdStr = data.subscriptionId || data.subId;
        const cleanSubId = subIdStr ? parseInt(String(subIdStr).replace(/^sub_/, ""), 10) : null;

        if (cleanSubId !== null && !isNaN(cleanSubId)) {
            const amount = data.amount ? parseFloat(String(data.amount)) : 0;
            const period = data.period ? parseInt(String(data.period), 10) : 0;
            const nextPayment = data.nextPayment || data.timestamp || Math.floor(Date.now() / 1000) + period;
            const nextPaymentDate = new Date(Number(nextPayment) * 1000).toISOString();
            
            let status = "ACTIVE";
            if (
                event === "subscription.cancelled" || 
                event === "subscription.expired" || 
                event === "subscription.payment.failed"
            ) {
                status = "EXPIRED";
            }

            const { error: subError } = await supabase
                .from("subscriptions")
                .upsert({
                    subscription_id: cleanSubId,
                    merchant_address: merchantAddress,
                    subscriber: data.subscriber ? String(data.subscriber).toLowerCase() : null,
                    current_nonce: data.currentNonce !== undefined ? parseInt(String(data.currentNonce), 10) : 0,
                    last_settlement_timestamp: nextPaymentDate,
                    billing_interval_seconds: period,
                    amount_cap_usdc: amount,
                    payment_tx_hash: data.nextCommitment || data.nullifierHash || null,
                    status: status,
                    updated_at: new Date().toISOString()
                }, { onConflict: "subscription_id" });

            if (subError) {
                console.error("[Webhook Database Error] Subscription upsert failed:", subError);
                throw new Error(`Failed to sync subscription details: ${subError.message}`);
            }

            if (status === "EXPIRED") {
                triggerExitSurvey(merchantAddress, cleanSubId, 0).catch(err => {
                    console.error("Failed to trigger exit survey:", err);
                });
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
        } else if (merchantInfo && merchantInfo.tier >= 1) {
            console.log(`[Premium Rerouting Active] Payout mapping fetched for ${merchantAddress}:`, {
                tier: merchantInfo.tier,
                payoutDestination: merchantInfo.payout_destination || "Default connected address"
            });
            /* Execute premium alerts or configure automated payout cycles here */
        }

        return NextResponse.json({ success: true, message: "Webhook processed and synced to Supabase" });

    } catch (err: any) {
        console.error("[CRITICAL Webhook Exception] Transaction execution failed. Reverting state changes.", err);
        
        /* Manual transaction rollback boundary to preserve off-chain database integrity */
        if (eventIdInserted) {
            console.log(`[Rollback Active] Deleting logged webhook event ID: ${eventIdInserted}`);
            try {
                await supabase.from("webhook_events").delete().eq("id", eventIdInserted);
            } catch (rollbackErr: any) {
                console.error("[CRITICAL Rollback Failed] Failed to delete logged event during rollback:", rollbackErr);
            }
        }

        return NextResponse.json({ error: "Database transaction failed", details: err.message }, { status: 500 });
    }
}
