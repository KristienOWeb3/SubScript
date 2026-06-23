import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { ethers } from "ethers";
import { getAccountRole } from "@/lib/accounts/roles";
import { withPgClient } from "@/lib/serverPg";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { encryptPrivateKey } from "@/lib/crypto";
import { getCircleEmail, type CircleSocialAuth } from "@/lib/circle/client";
import { setSessionCookie } from "@/lib/authCookies";

function isCircleSocialAuth(value: any): value is CircleSocialAuth {
    return value &&
        typeof value.userToken === "string";
}

/*
 * Completes "Continue with Google". Google is used only to verify the email; the account is the SAME
 * server-managed embedded wallet model as email/OTP — one account per email. So:
 *   - If the email already has an account (via OTP or a prior Google login), we log into THAT wallet.
 *   - Otherwise we provision a fresh embedded wallet for it.
 * We intentionally do NOT create a Circle-managed (PIN) wallet, which is what previously failed with
 * "Error encrypting data" during the SDK challenge and also produced a second, separate account.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const circleAuth = body?.circleAuth;
        const email = isCircleSocialAuth(circleAuth) ? getCircleEmail(circleAuth) : "";

        if (!isCircleSocialAuth(circleAuth) || !email) {
            return NextResponse.json({ error: "Could not read a verified Google email. Please try again." }, { status: 400 });
        }

        const emailLower = email.toLowerCase().trim();
        const googleSubject = circleAuth.oAuthInfo?.socialUserUUID || null;

        /* Preserve the existing guard: an email bound to a wallet-only (external) account can't be
           taken over by a server session — that user signs in by connecting their wallet. */
        const existingMapping = await withPgClient((client) => findAccountEmailBinding(client, emailLower));
        if (isWalletOnlyEmailBinding(existingMapping)) {
            return NextResponse.json({
                error: "This email is linked to a wallet-only SubScript account. Connect that wallet to sign in."
            }, { status: 409 });
        }

        const walletAddress = await withPgClient(async (client) => {
            /* Same email -> same account: reuse the existing embedded wallet if there is one. */
            const existing = await client.query(
                `select wallet_address from user_embedded_wallets where email = $1 limit 1`,
                [emailLower]
            );
            if (existing.rows[0]?.wallet_address) {
                await client.query(
                    `update user_embedded_wallets
                        set google_subject = coalesce(google_subject, $2), updated_at = now()
                      where email = $1`,
                    [emailLower, googleSubject]
                );
                return String(existing.rows[0].wallet_address).toLowerCase();
            }

            /* First time for this email: provision a server-managed embedded wallet (like OTP). */
            const generated = ethers.Wallet.createRandom();
            const encryptedKey = encryptPrivateKey(generated.privateKey);
            await client.query(
                `insert into user_embedded_wallets (email, wallet_address, encrypted_private_key, provider, google_subject, updated_at)
                 values ($1, $2, $3, 'google', $4, now())
                 on conflict (email) do nothing`,
                [emailLower, generated.address.toLowerCase(), encryptedKey, googleSubject]
            );
            /* Re-read so a concurrent first login can't create two wallets for one email. */
            const after = await client.query(
                `select wallet_address from user_embedded_wallets where email = $1 limit 1`,
                [emailLower]
            );
            return String(after.rows[0].wallet_address).toLowerCase();
        });

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "JWT_SECRET is not configured" }, { status: 500 });
        }

        const role = await getAccountRole(walletAddress);

        const jwt = await new SignJWT({
            address: walletAddress,
            email: emailLower,
            provider: "google",
            authenticatedAt: Date.now(),
        })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("30d")
            .sign(new TextEncoder().encode(secretStr));

        const response = NextResponse.json({
            success: true,
            wallet: walletAddress,
            email: emailLower,
            provider: "google",
            role,
        });

        setSessionCookie(response, request, jwt, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

        return response;
    } catch (error: any) {
        console.error("Google login completion error:", error);
        return NextResponse.json({ error: error.message || "Failed to complete Google sign-in" }, { status: 500 });
    }
}
