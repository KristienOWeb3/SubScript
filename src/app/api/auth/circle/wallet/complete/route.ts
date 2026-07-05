import { NextResponse } from "next/server";
import { provisionEmbeddedWallet } from "@/lib/custody/provision";
import { SignJWT } from "jose";
import { getAccountRole } from "@/lib/accounts/roles";
import { setSessionCookie } from "@/lib/authCookies";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";
import { withPgClient, pgMaybeOne } from "@/lib/serverPg";
import crypto from "crypto";

async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<{ email: string; sub: string } | null> {
    try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!res.ok) return null;
        const payload = await res.json();
        
        if (
            (payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com") &&
            payload.aud === clientId &&
            payload.email_verified === "true" &&
            payload.email
        ) {
            return { email: payload.email.toLowerCase(), sub: payload.sub };
        }
        return null;
    } catch (e) {
        console.error("Google ID token verification failed:", e);
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const googleIdToken = body.googleIdToken;

        if (!googleIdToken) {
            return NextResponse.json({ error: "Missing Google ID token" }, { status: 400 });
        }

        const clientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID;
        if (!clientId) {
            return NextResponse.json({ error: "Google client configuration missing on server" }, { status: 500 });
        }

        const verifiedUser = await verifyGoogleIdToken(googleIdToken, clientId);
        if (!verifiedUser) {
            return NextResponse.json({ error: "Invalid Google ID token" }, { status: 401 });
        }

        const emailVal = verifiedUser.email;

        // Try to find the user's existing wallet first
        let walletAddress: string;
        let walletRecord = await pgMaybeOne<{ wallet_address: string }>(
            "select wallet_address from user_embedded_wallets where email = $1 limit 1",
            [emailVal]
        );

        if (walletRecord) {
            walletAddress = walletRecord.wallet_address;
        } else {
            const refId = crypto.createHash("sha256").update(emailVal).digest("hex");
            const provisioned = await provisionEmbeddedWallet({ refId });
            walletAddress = provisioned.address;

            try {
                await withPgClient(async (client) => {
                    await client.query(
                        `insert into user_embedded_wallets (email, wallet_address, encrypted_private_key, circle_wallet_id, provider, updated_at)
                         values ($1, $2, $3, $4, 'circle_google', now())
                         on conflict (email) do update set
                            wallet_address = excluded.wallet_address,
                            encrypted_private_key = excluded.encrypted_private_key,
                            circle_wallet_id = excluded.circle_wallet_id,
                            provider = excluded.provider,
                            updated_at = now()`,
                        [emailVal, walletAddress.toLowerCase(), provisioned.encryptedPrivateKey, provisioned.circleWalletId]
                    );
                });
            } catch (dbErr) {
                console.error("Failed to store Google embedded wallet:", dbErr);
                return NextResponse.json({ error: "Failed to save embedded wallet." }, { status: 500 });
            }
        }

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "Internal Server Error: Secret key configuration missing" }, { status: 500 });
        }

        const secret = new TextEncoder().encode(secretStr);
        const sessionDuration = 24 * 60 * 60 * 1000; // 1 day
        const expiresAt = new Date(Date.now() + sessionDuration);

        // Sign the session token
        const jwt = await new SignJWT({ address: walletAddress.toLowerCase(), authenticatedAt: Date.now() })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("1d")
            .sign(secret);

        await ensureDefaultAliasFromEmail(walletAddress, emailVal);

        const role = await getAccountRole(walletAddress);

        const response = NextResponse.json({
            success: true,
            wallet: walletAddress,
            email: emailVal,
            role
        });

        setSessionCookie(response, request, jwt, expiresAt);

        return response;
    } catch (err: any) {
        console.error("Google wallet complete error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
