import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { validateWebhookUrl } from "@/lib/webhookUrls";
import { requireEnterpriseAndPremium, authenticateMerchant } from "@/lib/v1/merchantAuth";
import { encryptWebhookSecret } from "@/lib/webhooks";

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

function redactWebhookSecret(secret: string | null | undefined): string {
    if (!secret) return "";
    return `${secret.slice(0, 10)}...${secret.slice(-4)}`;
}

type LatestDeliveryRow = {
    webhookEndpointId: string;
    event: string | null;
    status: number | null;
    responseBody: string | null;
    createdAt: Date;
};

async function getLatestDeliveriesByEndpoint(endpointIds: string[]): Promise<LatestDeliveryRow[]> {
    if (endpointIds.length === 0) return [];
    return prisma.$queryRaw<LatestDeliveryRow[]>(Prisma.sql`
        WITH requested_endpoints(id) AS (
            VALUES ${Prisma.join(
                endpointIds.map((endpointId) => Prisma.sql`(${endpointId}::uuid)`),
            )}
        )
        SELECT
            requested.id AS "webhookEndpointId",
            latest.event,
            latest.status,
            latest.response_body AS "responseBody",
            latest.created_at AS "createdAt"
        FROM requested_endpoints AS requested
        CROSS JOIN LATERAL (
            SELECT event, status, response_body, created_at
            FROM webhook_events
            WHERE webhook_endpoint_id = requested.id
            ORDER BY created_at DESC
            LIMIT 1
        ) AS latest
    `);
}

export async function GET(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const wallet = auth.merchantAddress;

        const supabase = getSupabase();

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
        let deliveries: LatestDeliveryRow[] = [];
        try {
            deliveries = await getLatestDeliveriesByEndpoint(endpointIds);
        } catch (deliveryError) {
            console.error("GET latest webhook deliveries error:", deliveryError);
        }
        const latestDeliveryByEndpoint = new Map<string, LatestDeliveryRow>();
        for (const delivery of deliveries || []) {
            latestDeliveryByEndpoint.set(delivery.webhookEndpointId, delivery);
        }

        const endpointsWithLatestDelivery = (endpoints || []).map((e: any) => {
            const latestDelivery = latestDeliveryByEndpoint.get(e.id);
            return {
                id: e.id,
                walletAddress: e.wallet_address,
                url: e.url,
                secret: e.ciphertext ? "whsec_••••••••" : "",
                secretAvailable: false,
                active: e.active,
                environment: e.environment || "TEST",
                enabledEvents: e.enabled_events || [],
                apiVersion: e.api_version || "2026-07-01",
                description: e.description,
                status: e.status || "ACTIVE",
                createdAt: e.created_at,
                apiKey,
                latestDelivery: latestDelivery
                    ? {
                        event: latestDelivery.event,
                        status: latestDelivery.status,
                        lastAttemptAt: latestDelivery.createdAt,
                        responseBody: latestDelivery.responseBody,
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
        const auth = await authenticateMerchant(request);
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const wallet = auth.merchantAddress;

        const premiumCheck = await requireEnterpriseAndPremium(wallet);
        if (!premiumCheck.ok) {
            return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !body.url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const { url, environment, api_version, enabled_events, description } = body;
        const urlValidation = await validateWebhookUrl(url);
        if (!urlValidation.ok) {
            return NextResponse.json({ error: urlValidation.error }, { status: 400 });
        }

        const env = environment === "LIVE" ? "LIVE" : "TEST";
        if (auth.mode === "test" && env === "LIVE") {
            return NextResponse.json({ error: "Forbidden: TEST API credentials cannot configure LIVE endpoints." }, { status: 400 });
        }

        const apiVersion = api_version || "2026-07-01";
        const enabledEvents = Array.isArray(enabled_events) ? enabled_events : [];

        const id = crypto.randomUUID();
        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
        const encryption = encryptWebhookSecret(secret, id, wallet);

        const supabase = getSupabase();

        const { data: endpoint, error: insertError } = await supabase
            .from("webhook_endpoints")
            .insert({
                id,
                wallet_address: wallet.toLowerCase(),
                url: urlValidation.url,
                ciphertext: encryption.ciphertext,
                nonce: encryption.nonce,
                authentication_tag: encryption.authenticationTag,
                key_version: encryption.keyVersion,
                encryption_algorithm: encryption.encryptionAlgorithm,
                active: true,
                environment: env,
                enabled_events: enabledEvents,
                api_version: apiVersion,
                description: description || null,
                status: "ACTIVE",
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
            secret,
            secretAvailable: true,
            active: endpoint.active,
            environment: endpoint.environment,
            enabledEvents: endpoint.enabled_events || [],
            apiVersion: endpoint.api_version,
            description: endpoint.description,
            status: endpoint.status,
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
        const auth = await authenticateMerchant(request);
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const wallet = auth.merchantAddress;

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Missing endpoint ID" }, { status: 400 });
        }

        const supabase = getSupabase();
        
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
