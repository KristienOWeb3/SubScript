import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWebhookRequest } from "@/lib/webhooks";
import crypto from "crypto";
import { sanitizeInput } from "@/utils/security";

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Internal Server Error: Keeper secret key configuration missing" }, { status: 500 });
        }
        
        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { walletAddress, event, data } = sanitizedBody;

        if (
            typeof walletAddress !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
            typeof event !== "string" ||
            !data ||
            typeof data !== "object"
        ) {
            return NextResponse.json(
                { error: "Malformed payload parameters" },
                { status: 400 }
            );
        }

        const normalizedWallet = walletAddress.toLowerCase();
        const supabase = getSupabase();

        const { data: merchantData, error: merchantErr } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedWallet)
            .maybeSingle();

        if (merchantErr) {
            console.error(`[dispatch] Failed to query merchant: ${merchantErr.message}`);
        }
        const dbMerchantTier = merchantData ? merchantData.tier : "FREE";
        if (dbMerchantTier !== "PREMIUM") {
            console.warn(`[dispatch] Skip dispatch: Merchant ${normalizedWallet} is not premium (Tier ${dbMerchantTier}).`);
            return NextResponse.json({ error: "Forbidden: Event dispatching requires an active premium tier." }, { status: 403 });
        }

        const { data: endpoints, error: fetchError } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("wallet_address", normalizedWallet)
            .eq("active", true);

        if (fetchError || !endpoints || endpoints.length === 0) {
            return NextResponse.json({
                success: true,
                message: "No active webhook endpoints registered for this wallet.",
                dispatchedCount: 0,
            });
        }

        const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`;
        const webhookPayload = {
            id: eventId,
            event,
            created: Math.floor(Date.now() / 1000),
            data,
        };

        const deliveryPromises = endpoints.map(async (endpoint: any) => {
            const { status, responseText } = await sendWebhookRequest(
                endpoint.url,
                webhookPayload,
                endpoint.secret
            );

            const { error: insertError } = await supabase
                .from("webhook_events")
                .insert({
                    webhook_endpoint_id: endpoint.id,
                    event,
                    status,
                    payload: webhookPayload,
                    response_body: responseText,
                });

            if (insertError) {
                console.error("Failed to log webhook event:", insertError);
            }
        });

        await Promise.all(deliveryPromises);

        return NextResponse.json({
            success: true,
            message: `Dispatched to ${endpoints.length} webhook endpoint(s).`,
            dispatchedCount: endpoints.length,
            eventId,
        });
    } catch (error: any) {
        console.error("Webhook dispatch error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
