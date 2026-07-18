import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { validateWebhookUrl } from "@/lib/webhookUrls";

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

async function checkMerchantPremium(supabase: any, walletAddress: string): Promise<boolean> {
    const { data: merchant, error } = await supabase
        .from("merchants")
        .select("tier")
        .eq("wallet_address", walletAddress.toLowerCase())
        .maybeSingle();
    if (error || !merchant) return false;
    return merchant.tier === "PREMIUM";
}

function redactWebhookSecret(secret: string | null | undefined): string {
    if (!secret) return "";
    return `${secret.slice(0, 10)}...${secret.slice(-4)}`;
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }

        const { data: endpoints, error } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("wallet_address", wallet.toLowerCase())
            .order("created_at", { ascending: false });

        if (error) {
            console.error("GET webhook endpoints error:", error);
            return NextResponse.json({ error: "Failed to retrieve webhook endpoints" }, { status: 500 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const { data: activeKey, error: keyError } = await supabase
            .from("api_keys")
            .select("id, publishable_key, secret_key_hint, mode, created_at")
            .eq("wallet_address", normalizedWallet)
            .eq("revoked", false)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (keyError) {
            console.error("GET webhook endpoint API-key linkage error:", keyError);
        }

        const apiKey = activeKey
            ? {
                id: activeKey.id,
                publishableKey: activeKey.publishable_key,
                fingerprint: activeKey.secret_key_hint || "",
                mode: activeKey.mode || "TEST",
                createdAt: activeKey.created_at,
            }
            : null;

        const endpointIds = (endpoints || []).map((endpoint: any) => endpoint.id);
        const { data: deliveries, error: deliveryError } = endpointIds.length
            ? await supabase
                .from("webhook_events")
                .select("webhook_endpoint_id, event, status, response_body, created_at")
                .in("webhook_endpoint_id", endpointIds)
                .order("created_at", { ascending: false })
            : { data: [], error: null };
        if (deliveryError) {
            console.error("GET latest webhook deliveries error:", deliveryError);
        }
        /* Events arrive newest-first. The first row recorded for each endpoint is therefore its
           latest delivery, without issuing one database request per endpoint. */
        const latestDeliveryByEndpoint = new Map<string, any>();
        for (const delivery of deliveries || []) {
            if (!latestDeliveryByEndpoint.has(delivery.webhook_endpoint_id)) {
                latestDeliveryByEndpoint.set(delivery.webhook_endpoint_id, delivery);
            }
        }

        const endpointsWithLatestDelivery = (endpoints || []).map((e: any) => {
            const latestDelivery = latestDeliveryByEndpoint.get(e.id);
            return {
                id: e.id,
                walletAddress: e.wallet_address,
                url: e.url,
                secret: redactWebhookSecret(e.secret),
                secretAvailable: false,
                active: e.active,
                createdAt: e.created_at,
                apiKey,
                latestDelivery: latestDelivery
                    ? {
                        event: latestDelivery.event,
                        status: latestDelivery.status,
                        lastAttemptAt: latestDelivery.created_at,
                        responseBody: latestDelivery.response_body,
                    }
                    : null,
            };
        });

        return NextResponse.json({
            merchant: {
                walletAddress: normalizedWallet,
                apiKey,
            },
            endpoints: endpointsWithLatestDelivery,
        }, { status: 200 });
    } catch (error: any) {
        console.error("GET webhook endpoints error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !body.url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const { url } = body;
        const urlValidation = await validateWebhookUrl(url);
        if (!urlValidation.ok) {
            return NextResponse.json({ error: urlValidation.error }, { status: 400 });
        }

        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

        const { data: endpoint, error: insertError } = await supabase
            .from("webhook_endpoints")
            .insert({
                wallet_address: wallet.toLowerCase(),
                url: urlValidation.url,
                secret,
                active: true,
            })
            .select()
            .single();

        if (insertError) {
            console.error("POST webhook endpoint error:", insertError);
            return NextResponse.json({ error: "Failed to register webhook endpoint" }, { status: 500 });
        }

        const camelCaseEndpoint = {
            id: endpoint.id,
            walletAddress: endpoint.wallet_address,
            url: endpoint.url,
            secret: endpoint.secret,
            secretAvailable: true,
            active: endpoint.active,
            createdAt: endpoint.created_at,
        };

        return NextResponse.json({ endpoint: camelCaseEndpoint }, { status: 201 });
    } catch (error: any) {
        console.error("POST webhook endpoint error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Missing endpoint ID" }, { status: 400 });
        }

        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }
        
        const { data: endpointCheck, error: checkError } = await supabase
            .from("webhook_endpoints")
            .select("wallet_address")
            .eq("id", id)
            .maybeSingle();

        if (checkError || !endpointCheck) {
            return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
        }

        if (endpointCheck.wallet_address !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { error: deleteError } = await supabase
            .from("webhook_endpoints")
            .delete()
            .eq("id", id);

        if (deleteError) {
            console.error("DELETE webhook endpoint error:", deleteError);
            return NextResponse.json({ error: "Failed to delete webhook endpoint" }, { status: 500 });
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
        console.error("DELETE webhook endpoint error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
