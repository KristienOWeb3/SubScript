import { NextResponse } from "next/server";
import { getVerifiedSessionToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/authCookies";
import { getAccountRole } from "@/lib/accounts/roles";
import { isConnectionError, getOfflineUserEmbeddedWalletByAddress } from "@/lib/offlineDb";
import { pgMaybeOne } from "@/lib/serverPg";

type EmbeddedWalletSession = {
    email: string | null;
    provider: string | null;
};

export async function GET(request: Request) {
    try {
        const session = await getVerifiedSessionToken(request.headers);

        if (!session) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }
        const wallet = session.wallet;

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

        /* Wallet-only accounts (e.g. auto-onboarded payers) have no embedded-wallet row,
           so fall back to the email captured on their customer profile. This keeps the
           "add your email" prompt from re-appearing after they've provided one. */
        if (!email) {
            try {
                const customer = await pgMaybeOne<{ email: string | null }>(
                    "select email from customers where wallet_address = $1 limit 1",
                    [wallet.toLowerCase()]
                );
                if (customer?.email) {
                    email = customer.email;
                }
            } catch (err) {
                console.error("Session customer email lookup error:", err);
            }
        }

        const role = await getAccountRole(wallet);
        const isEmbedded = Boolean(provider && provider !== "external_wallet");

        const response = NextResponse.json({
            loggedIn: true,
            wallet,
            email,
            provider,
            isEmbedded,
            role
        }, { status: 200 });

        /* Self-heal cookie scoping: re-issue the SAME token (original expiry, never
           extended) with the current cookie options. Sessions created before the
           domain-wide cookie helper — or on a host outside its old allowlist — carry a
           host-only cookie the dashboard subdomain can't see, so "Go to Dashboard"
           silently bounced back to login. Every session check now upgrades the cookie
           to .subscriptonarc.com scope before the user navigates. */
        if (session.expiresAt && session.expiresAt > new Date()) {
            setSessionCookie(response, request, session.token, session.expiresAt);
        }

        return response;
    } catch (error) {
        console.error("Session API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

