import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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
    return merchant.tier >= 1;
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

        const camelCaseEndpoints = (endpoints || []).map((e: any) => ({
            id: e.id,
            walletAddress: e.wallet_address,
            url: e.url,
            secret: e.secret,
            active: e.active,
            createdAt: e.created_at,
        }));

        return NextResponse.json({ endpoints: camelCaseEndpoints }, { status: 200 });
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

        try {
            new URL(url);
        } catch (_) {
            return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
        }

        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

        const { data: endpoint, error: insertError } = await supabase
            .from("webhook_endpoints")
            .insert({
                wallet_address: wallet.toLowerCase(),
                url,
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
