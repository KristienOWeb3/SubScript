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
    return merchant.tier === "PREMIUM";
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
            secretKeyPlain: k.secret_key_plain,
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

        const { error: revokeError } = await supabase
            .from("api_keys")
            .update({ revoked: true })
            .eq("wallet_address", walletLower)
            .eq("revoked", false);

        if (revokeError) {
            console.error("Failed to revoke older keys:", revokeError);
        }

        const publishableKey = `pk_test_${crypto.randomBytes(24).toString("hex")}`;
        const secretKeyPlain = `sk_test_${crypto.randomBytes(32).toString("hex")}`;

        const { data: newKey, error: insertError } = await supabase
            .from("api_keys")
            .insert({
                wallet_address: walletLower,
                publishable_key: publishableKey,
                secret_key_plain: secretKeyPlain,
                revoked: false,
            })
            .select()
            .single();

        if (insertError) {
            console.error("POST API key error:", insertError);
            return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
        }

        const camelCaseKey = {
            id: newKey.id,
            walletAddress: newKey.wallet_address,
            publishableKey: newKey.publishable_key,
            secretKeyPlain: newKey.secret_key_plain,
            createdAt: newKey.created_at,
            revoked: newKey.revoked,
        };

        return NextResponse.json({ key: camelCaseKey }, { status: 201 });
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
            secretKeyPlain: updatedKey.secret_key_plain,
            createdAt: updatedKey.created_at,
            revoked: updatedKey.revoked,
        };

        return NextResponse.json({ success: true, key: camelCaseKey }, { status: 200 });
    } catch (error: any) {
        console.error("DELETE API key error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
