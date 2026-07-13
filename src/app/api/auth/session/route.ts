import { NextResponse } from "next/server";
import { getVerifiedSessionToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/authCookies";
import { getAccountRole } from "@/lib/accounts/roles";
import { isConnectionError, getOfflineUserEmbeddedWalletByAddress } from "@/lib/offlineDb";
import { pgMaybeOne } from "@/lib/serverPg";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";

type EmbeddedWalletSession = {
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
            const [data, verifiedEmail] = await Promise.all([
                pgMaybeOne<EmbeddedWalletSession>(
                "select provider from user_embedded_wallets where wallet_address = $1 limit 1",
                [wallet.toLowerCase()]
                ),
                getVerifiedAccountEmail(wallet),
            ]);
            if (data) {
                provider = data.provider || null;
            }
            email = verifiedEmail?.email || null;
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
        const isEmbedded = Boolean(provider && !provider.startsWith("external_wallet"));

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

