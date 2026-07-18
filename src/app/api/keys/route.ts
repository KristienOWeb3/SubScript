import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { hashSecretKey, secretKeyHint } from "@/lib/apiKeys";
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

function redactSecretKey(secretKey: string | null | undefined): string {
    if (!secretKey) return "";
    return `${secretKey.slice(0, 8)}...${secretKey.slice(-4)}`;
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

        const { data: keys, error } = await supabase
            .from("api_keys")
            .select("*")
            .eq("wallet_address", wallet.toLowerCase())
            .eq("revoked", false)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("GET API keys error:", error);
            return NextResponse.json({ error: "Failed to retrieve API keys" }, { status: 500 });
        }

        const camelCaseKeys = (keys || []).map((k: any) => ({
            id: k.id,
            walletAddress: k.wallet_address,
            publishableKey: k.publishable_key,
            secretKeyPlain: k.secret_key_hint || redactSecretKey(k.secret_key_plain),
            secretKeyAvailable: false,
            createdAt: k.created_at,
            revoked: k.revoked,
        }));

        return NextResponse.json({ keys: camelCaseKeys }, { status: 200 });
    } catch (error: any) {
        console.error("GET API keys error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const walletLower = wallet.toLowerCase();
        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }
        const requestedWebhookUrl = "webhookUrl" in body ? body.webhookUrl : undefined;
        if (requestedWebhookUrl !== undefined && typeof requestedWebhookUrl !== "string") {
            return NextResponse.json({ error: "webhookUrl must be a string" }, { status: 400 });
        }
        const webhookUrl = typeof requestedWebhookUrl === "string" && requestedWebhookUrl.trim()
            ? requestedWebhookUrl.trim()
            : null;
        const validatedWebhook = webhookUrl ? await validateWebhookUrl(webhookUrl) : null;
        if (validatedWebhook && !validatedWebhook.ok) {
            return NextResponse.json({ error: validatedWebhook.error }, { status: 400 });
        }

        const publishableKey = `pk_test_${crypto.randomBytes(24).toString("hex")}`;
        const secretKeyPlain = `sk_test_${crypto.randomBytes(32).toString("hex")}`;

        /* Atomic rotation: the replacement key is created FIRST and the old keys are revoked in
           the same database transaction. If the insert fails, nothing is revoked — a merchant
           can never be left with zero working keys. Only hash + hint leave this process. */
        const { data: rotated, error: rotateError } = await supabase.rpc("rotate_merchant_api_key", {
            p_wallet: walletLower,
            p_publishable_key: publishableKey,
            p_secret_key_hash: hashSecretKey(secretKeyPlain),
            p_secret_key_hint: secretKeyHint(secretKeyPlain),
        });

        if (rotateError || !rotated?.id) {
            console.error("POST API key rotation error:", rotateError?.message);
            return NextResponse.json({ error: "Failed to create API key; existing keys were preserved." }, { status: 500 });
        }

        const camelCaseKey = {
            id: rotated.id,
            walletAddress: rotated.walletAddress,
            publishableKey: rotated.publishableKey,
            mode: rotated.mode,
            /* One-time reveal of the full secret. After this response it cannot be retrieved again. */
            secretKeyPlain,
            secretKeyAvailable: true,
            createdAt: rotated.createdAt,
            revoked: false,
        };

        let webhookEndpoint: {
            id: string;
            walletAddress: string;
            url: string;
            secret: string;
            secretAvailable: true;
            active: boolean;
            createdAt: string;
        } | null = null;
        let webhookWarning: string | null = null;

        /* Key issuance has already succeeded, so webhook setup is deliberately best-effort.
           Always return the one-time key secret even if endpoint storage fails; otherwise the
           merchant would lose the only opportunity to copy it and needlessly rotate again. */
        if (validatedWebhook?.ok) {
            const webhookSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
            const { data: endpoint, error: endpointError } = await supabase
                .from("webhook_endpoints")
                .insert({
                    wallet_address: walletLower,
                    url: validatedWebhook.url,
                    secret: webhookSecret,
                    active: true,
                })
                .select()
                .single();

            if (endpointError || !endpoint) {
                console.error("POST API key webhook registration error:", endpointError?.message);
                webhookWarning = "API key created, but the webhook endpoint could not be registered. Copy the key now, then add the endpoint from Developers → Webhooks.";
            } else {
                webhookEndpoint = {
                    id: endpoint.id,
                    walletAddress: endpoint.wallet_address,
                    url: endpoint.url,
                    secret: endpoint.secret,
                    secretAvailable: true,
                    active: endpoint.active,
                    createdAt: endpoint.created_at,
                };
            }
        }

        return NextResponse.json({
            key: camelCaseKey,
            ...(webhookEndpoint ? { webhookEndpoint } : {}),
            ...(webhookWarning ? { webhookWarning } : {}),
        }, { status: 201 });
    } catch (error: any) {
        console.error("POST API key error:", error);
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
            return NextResponse.json({ error: "Missing key ID" }, { status: 400 });
        }

        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }
        
        const { data: keyCheck, error: checkError } = await supabase
            .from("api_keys")
            .select("wallet_address")
            .eq("id", id)
            .maybeSingle();

        if (checkError || !keyCheck) {
            return NextResponse.json({ error: "API Key not found" }, { status: 404 });
        }

        if (keyCheck.wallet_address !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { data: updatedKey, error: updateError } = await supabase
            .from("api_keys")
            .update({ revoked: true })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("DELETE API key error:", updateError);
            return NextResponse.json({ error: "Failed to revoke API key" }, { status: 500 });
        }

        const camelCaseKey = {
            id: updatedKey.id,
            walletAddress: updatedKey.wallet_address,
            publishableKey: updatedKey.publishable_key,
            secretKeyPlain: updatedKey.secret_key_hint || redactSecretKey(updatedKey.secret_key_plain),
            secretKeyAvailable: false,
            createdAt: updatedKey.created_at,
            revoked: updatedKey.revoked,
        };

        return NextResponse.json({ success: true, key: camelCaseKey }, { status: 200 });
    } catch (error: any) {
        console.error("DELETE API key error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
