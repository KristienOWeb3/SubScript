import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { decryptPrivateKey } from "@/lib/crypto";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        
        if (!wallet) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }

        let privateKey: string | null = null;
        let email: string | null = null;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const { data } = await supabase
                .from("user_embedded_wallets")
                .select("email, encrypted_private_key")
                .eq("wallet_address", wallet.toLowerCase())
                .maybeSingle();

            if (data) {
                privateKey = decryptPrivateKey(data.encrypted_private_key);
                email = data.email;
            }
        }

        return NextResponse.json({ 
            loggedIn: true, 
            wallet,
            privateKey,
            email
        }, { status: 200 });
    } catch (error) {
        console.error("Session API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
