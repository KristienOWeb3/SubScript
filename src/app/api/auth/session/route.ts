import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { getAccountRole } from "@/lib/accounts/roles";
import { isConnectionError, getOfflineUserEmbeddedWalletByAddress } from "@/lib/offlineDb";
import { pgMaybeOne } from "@/lib/serverPg";

type EmbeddedWalletSession = {
    email: string | null;
    provider: string | null;
};

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        
        if (!wallet) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }

        let email: string | null = null;
        let provider: string | null = null;
        let isOfflineMode = false;

        try {
            const data = await pgMaybeOne<EmbeddedWalletSession>(
                "select email, provider from user_embedded_wallets where wallet_address = $1 limit 1",
                [wallet.toLowerCase()]
            );
            if (data) {
                email = data.email;
                provider = data.provider || null;
            }
        } catch (err: any) {
            if (isConnectionError(err)) {
                isOfflineMode = true;
            } else {
                console.error("Session wallet lookup error:", err);
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

