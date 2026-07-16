import { NextResponse } from "next/server";
import { getVerifiedSessionToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/authCookies";
import { getAccountRole } from "@/lib/accounts/roles";
import { isConnectionError, getOfflineUserEmbeddedWalletByAddress } from "@/lib/offlineDb";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { getWalletCustody, isCustodialWallet, type WalletCustody } from "@/lib/auth/walletCustody";

export async function GET(request: Request) {
    try {
        const session = await getVerifiedSessionToken(request.headers);

        if (!session) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }
        const wallet = session.wallet;

        let email: string | null = null;
        let custody: WalletCustody | null = null;
        let isOfflineMode = false;

        try {
            const [walletCustody, verifiedEmail] = await Promise.all([
                getWalletCustody(wallet),
                getVerifiedAccountEmail(wallet),
            ]);
            custody = walletCustody;
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
                custody = { provider: "circle_google", hasCircleWallet: true, hasEncryptedKey: false };
            }
        }

        const role = await getAccountRole(wallet);
        const provider = custody?.provider ?? null;
        /* Custody decides this, not the provider label. The old test was
           !provider.startsWith("external_wallet"), which alone among this column's consumers read
           'external_wallet_email_otp' — stamped on by /api/user/email when a wallet binds an OTP
           email — as a browser wallet. A Circle-custodied account that had verified an email was
           told to connect an extension, with no way to pay from the account it was signed into. */
        const isEmbedded = isCustodialWallet(custody);

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

