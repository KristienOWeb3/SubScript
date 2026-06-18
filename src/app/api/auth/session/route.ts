import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        
        if (!wallet) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }

        let email: string | null = null;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const { data } = await supabase
                .from("user_embedded_wallets")
                .select("email")
                .eq("wallet_address", wallet.toLowerCase())
                .maybeSingle();

            if (data) {
                email = data.email;
            }
        }

        let role: string | null = null;
        try {
            const roleRecord = await prisma.accountRole.findUnique({
                where: { address: wallet.toLowerCase() }
            });
            if (roleRecord) {
                role = roleRecord.role;
            }
        } catch (e) {
            console.warn("Could not load role from db:", e);
        }

        return NextResponse.json({ 
            loggedIn: true, 
            wallet,
            email,
            role
        }, { status: 200 });
    } catch (error) {
        console.error("Session API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

