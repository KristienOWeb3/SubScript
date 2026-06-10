import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ProtocolConfig } from "@/lib/payments/config";

/* Define parsing helper for request body */
async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

export async function GET(request: Request) {
    try {
        const merchantAddress = await getSessionWallet(request.headers);
        if (!merchantAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet" }, { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: links, error: fetchError } = await supabase
            .from("payment_links")
            .select("*")
            .eq("merchant_address", merchantAddress.toLowerCase())
            .order("created_at", { ascending: false });

        if (fetchError) {
            console.error("Error fetching payment links:", fetchError.message);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        return NextResponse.json({ links }, { status: 200 });

    } catch (error: any) {
        console.error("Payment links GET error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const merchantAddress = await getSessionWallet(request.headers);
        if (!merchantAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet" }, { status: 401 });
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON" }, { status: 400 });
        }

        const { title, description, amount_usdc, expires_at, external_reference } = body;

        if (!title || typeof title !== "string" || title.trim() === "") {
            return NextResponse.json({ error: "Bad Request: Title is required" }, { status: 400 });
        }

        /* Parse and validate amount_usdc as positive bigint */
        let amountBigInt: bigint;
        try {
            amountBigInt = BigInt(amount_usdc);
            if (amountBigInt <= BigInt(0)) {
                return NextResponse.json({ error: "Bad Request: Amount must be greater than 0" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid amount_usdc" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Get merchant's tier and count active links to enforce quotas */
        const [merchantRes, countRes] = await Promise.all([
            supabase
                .from("merchants")
                .select("tier")
                .eq("wallet_address", merchantAddress.toLowerCase())
                .maybeSingle(),
            supabase
                .from("payment_links")
                .select("id", { count: "exact", head: true })
                .eq("merchant_address", merchantAddress.toLowerCase())
                .eq("active", true)
                .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        ]);

        if (merchantRes.error) {
            console.error("Error fetching merchant tier:", merchantRes.error.message);
            return NextResponse.json({ error: merchantRes.error.message }, { status: 500 });
        }

        const tier = merchantRes.data ? Number(merchantRes.data.tier) : 0;
        const activeCount = countRes.count || 0;
        const limit = tier === 1 ? ProtocolConfig.MAX_PAYMENT_LINKS_TIER1 : ProtocolConfig.MAX_PAYMENT_LINKS_TIER0;

        if (activeCount >= limit) {
            return NextResponse.json({
                error: `Quota Exceeded: Active link limit of ${limit} reached for your merchant tier.`
            }, { status: 403 });
        }

        /* Insert new payment link */
        const { data: newLink, error: insertError } = await supabase
            .from("payment_links")
            .insert({
                merchant_address: merchantAddress.toLowerCase(),
                title,
                description: description || null,
                amount_usdc: amountBigInt.toString(),
                active: true,
                expires_at: expires_at
                    ? (() => {
                        const num = Number(expires_at);
                        if (!isNaN(num)) {
                            return new Date(num < 10000000000 ? num * 1000 : num).toISOString();
                        }
                        return new Date(expires_at).toISOString();
                    })()
                    : null,
                external_reference: external_reference || null
            })
            .select()
            .single();

        if (insertError) {
            console.error("Error inserting payment link:", insertError.message);
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        return NextResponse.json({ link: newLink }, { status: 201 });

    } catch (error: any) {
        console.error("Payment links POST error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
