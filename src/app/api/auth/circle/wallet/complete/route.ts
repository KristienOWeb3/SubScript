import { NextResponse } from "next/server";
import { provisionEmbeddedWallet } from "@/lib/custody/provision";
import { getAccountRole } from "@/lib/accounts/roles";
import { setSessionCookie } from "@/lib/authCookies";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";
import { withPgClient, pgMaybeOne } from "@/lib/serverPg";
import crypto from "crypto";
import { createSessionToken } from "@/lib/auth";
import * as jose from "jose";

const JWKS = jose.createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<{ email: string; sub: string; iss: string } | null> {
    try {
        const { payload } = await jose.jwtVerify(idToken, JWKS, {
            audience: clientId,
            issuer: ["accounts.google.com", "https://accounts.google.com"],
        });

        if (
            payload.email &&
            payload.sub &&
            payload.iss &&
            (payload.email_verified === "true" || payload.email_verified === true)
        ) {
            return {
                email: (payload.email as string).toLowerCase(),
                sub: payload.sub,
                iss: payload.iss,
            };
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
        const googleIdToken = body.googleIdToken || body.circleAuth?.oAuthInfo?.idToken;

        if (!googleIdToken) {
            return NextResponse.json({ error: "Missing Google ID token" }, { status: 400 });
        }

        const clientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
            return NextResponse.json({ error: "Google client configuration missing on server" }, { status: 500 });
        }

        const verifiedUser = await verifyGoogleIdToken(googleIdToken, clientId);
        if (!verifiedUser) {
            return NextResponse.json({ error: "Invalid Google ID token" }, { status: 401 });
        }

        const emailVal = verifiedUser.email;

        // Try to find the user's existing mapped identity first
        let walletAddress: string;
        let identityRecord = await pgMaybeOne<{ wallet_address: string; disabled_at: string | null }>(
            "select wallet_address, disabled_at from auth_identities where provider = 'google' and issuer = $1 and subject = $2 limit 1",
            [verifiedUser.iss, verifiedUser.sub]
        );

        if (identityRecord) {
            if (identityRecord.disabled_at) {
                return NextResponse.json({ error: "This identity has been disabled." }, { status: 403 });
            }
            walletAddress = identityRecord.wallet_address;

            // Update verification timestamp and current email
            try {
                await withPgClient(async (client) => {
                    await client.query(
                        "update auth_identities set last_verified_at = now(), current_email = $1 where provider = 'google' and issuer = $2 and subject = $3",
                        [emailVal, verifiedUser.iss, verifiedUser.sub]
                    );
                });
            } catch (updateErr) {
                console.error("Failed to update identity last_verified_at:", updateErr);
            }
        } else {
            // Check if there is an existing embedded wallet with this verified email
            const existingEmailWallet = await pgMaybeOne<{ wallet_address: string }>(
                "select wallet_address from user_embedded_wallets where email = $1 limit 1",
                [emailVal]
            );

            if (existingEmailWallet) {
                walletAddress = existingEmailWallet.wallet_address;
                try {
                    await withPgClient(async (client) => {
                        await client.query(
                            `insert into auth_identities (provider, issuer, subject, current_email, wallet_address, created_at, last_verified_at)
                             values ('google', $1, $2, $3, $4, now(), now())
                             on conflict (provider, issuer, subject) do update set
                                current_email = excluded.current_email,
                                last_verified_at = now()`,
                            [verifiedUser.iss, verifiedUser.sub, emailVal, walletAddress.toLowerCase()]
                        );
                    });
                } catch (linkErr) {
                    console.error("Failed to link Google identity to existing wallet:", linkErr);
                }
            } else {
                // Provision a brand new embedded wallet for the new user
                const refId = crypto.createHash("sha256").update(emailVal).digest("hex");
                const provisioned = await provisionEmbeddedWallet({ refId });
                walletAddress = provisioned.address;

                try {
                    await withPgClient(async (client) => {
                        await client.query("BEGIN");

                        await client.query(
                            `insert into user_embedded_wallets (email, wallet_address, encrypted_private_key, circle_wallet_id, provider, email_verified_at, updated_at)
                             values ($1, $2, $3, $4, 'circle_google', now(), now())`,
                            [emailVal, walletAddress.toLowerCase(), provisioned.encryptedPrivateKey, provisioned.circleWalletId]
                        );

                        await client.query(
                            `insert into auth_identities (provider, issuer, subject, current_email, wallet_address, created_at, last_verified_at)
                             values ('google', $1, $2, $3, $4, now(), now())`,
                            [verifiedUser.iss, verifiedUser.sub, emailVal, walletAddress.toLowerCase()]
                        );

                        await client.query("COMMIT");
                    });
                } catch (dbErr) {
                    console.error("Failed to store Google embedded wallet and identity:", dbErr);
                    return NextResponse.json({ error: "Failed to save embedded wallet and identity." }, { status: 500 });
                }
            }
        }

        const sessionDuration = 24 * 60 * 60 * 1000; // 1 day
        const { token: jwt, expiresAt } = await createSessionToken(walletAddress, sessionDuration);

        await ensureDefaultAliasFromEmail(walletAddress, emailVal);

        const role = await getAccountRole(walletAddress);

        const response = NextResponse.json({
            success: true,
            wallet: walletAddress,
            email: emailVal,
            role,
        });

        setSessionCookie(response, request, jwt, expiresAt);

        return response;
    } catch (err: any) {
        console.error("Google wallet complete error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
