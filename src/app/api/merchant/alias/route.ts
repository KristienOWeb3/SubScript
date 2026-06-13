/* Next.js API route for managing SubScript Domain Names (address aliases) */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* Normalizes alias name to lowercase, check characters (alphanumeric and hyphens, ending in .sub) */
const ALIAS_REGEX = /^[a-z0-9-]{3,15}\.sub$/;

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
        }

        const { data, error } = await supabaseAdmin
            .from("address_aliases")
            .select("address, alias, is_anonymous")
            .eq("address", normalizedUser)
            .maybeSingle();

        if (error) {
            console.error("Error fetching address alias:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!data) {
            return NextResponse.json({
                address: normalizedUser,
                alias: null,
                is_anonymous: false
            }, { status: 200 });
        }

        return NextResponse.json({
            address: data.address,
            alias: data.alias,
            is_anonymous: data.is_anonymous
        }, { status: 200 });

    } catch (err: any) {
        console.error("Alias GET error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { alias, isAnonymous } = body;

        if (alias !== null && alias !== undefined && alias !== "") {
            const normalizedAlias = String(alias).toLowerCase().trim();
            if (!ALIAS_REGEX.test(normalizedAlias)) {
                return NextResponse.json({ 
                    error: "Bad Request: Alias must be 3-15 alphanumeric characters/hyphens and end with '.sub'" 
                }, { status: 400 });
            }

            if (!supabaseAdmin) {
                return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
            }

            /* Check if the alias is already taken by another address */
            const { data: existing, error: checkErr } = await supabaseAdmin
                .from("address_aliases")
                .select("address")
                .eq("alias", normalizedAlias)
                .maybeSingle();

            if (checkErr) {
                console.error("Error checking alias availability:", checkErr.message);
                return NextResponse.json({ error: checkErr.message }, { status: 500 });
            }

            if (existing && existing.address !== normalizedUser) {
                return NextResponse.json({ error: "Conflict: Alias is already registered to another wallet" }, { status: 409 });
            }

            const { data, error } = await supabaseAdmin
                .from("address_aliases")
                .upsert({
                    address: normalizedUser,
                    alias: normalizedAlias,
                    is_anonymous: !!isAnonymous,
                    updated_at: new Date().toISOString()
                })
                .select("address, alias, is_anonymous")
                .single();

            if (error) {
                console.error("Error upserting address alias:", error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                address: data.address,
                alias: data.alias,
                is_anonymous: data.is_anonymous
            }, { status: 200 });
        } else {
            /* If alias is empty, it means we are clearing the alias */
            if (!supabaseAdmin) {
                return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
            }

            const { error } = await supabaseAdmin
                .from("address_aliases")
                .delete()
                .eq("address", normalizedUser);

            if (error) {
                console.error("Error clearing address alias:", error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                address: normalizedUser,
                alias: null,
                is_anonymous: false
            }, { status: 200 });
        }

    } catch (err: any) {
        console.error("Alias POST error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
        }

        const { error } = await supabaseAdmin
            .from("address_aliases")
            .delete()
            .eq("address", normalizedUser);

        if (error) {
            console.error("Error deleting address alias:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            address: normalizedUser,
            alias: null,
            is_anonymous: false
        }, { status: 200 });

    } catch (err: any) {
        console.error("Alias DELETE error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
