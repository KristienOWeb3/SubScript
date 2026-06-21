import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { getAccountRole } from "@/lib/accounts/roles";
import { isConnectionError, getOfflineUserEmbeddedWalletByAddress } from "@/lib/offlineDb";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        
        if (!wallet) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }

        let email: string | null = null;
        let provider: string | null = null;
        let isOfflineMode = false;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        
        if (!supabaseUrl || !supabaseServiceKey) {
            isOfflineMode = true;
        } else {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { data, error } = await supabase
                    .from("user_embedded_wallets")
                    .select("email, provider")
                    .eq("wallet_address", wallet.toLowerCase())
                    .maybeSingle();

                if (error) {
                    if (isConnectionError(error)) {
                        isOfflineMode = true;
                    } else {
                        console.error("Session Supabase check API error:", error);
                    }
                } else if (data) {
                    email = data.email;
                    provider = data.provider || null;
                }
            } catch (err: any) {
                if (isConnectionError(err)) {
                    isOfflineMode = true;
                } else {
                    console.error("Session Supabase check catch error:", err);
                }
            }
        }

        if (isOfflineMode) {
            console.warn("⚠️ Supabase is offline. Retrieving user email via offlineDb.");
            const walletRecord = getOfflineUserEmbeddedWalletByAddress(wallet.toLowerCase());
            if (walletRecord) {
                email = walletRecord.email;
                provider = "circle_google";
            }
        }

        const role = await getAccountRole(wallet);
        const isEmbedded = Boolean(provider && provider !== "external_wallet");

        return NextResponse.json({ 
            loggedIn: true, 
            wallet,
            email,
            provider,
            isEmbedded,
            role
        }, { status: 200 });
    } catch (error) {
        console.error("Session API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

