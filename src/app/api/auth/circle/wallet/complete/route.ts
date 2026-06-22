import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getAccountRole } from "@/lib/accounts/roles";
import { withPgClient } from "@/lib/serverPg";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { getCircleEmail, listCircleUserWallets, selectArcEoaWallet, type CircleSocialAuth } from "@/lib/circle/client";
import { setSessionCookie } from "@/lib/authCookies";

function isCircleSocialAuth(value: any): value is CircleSocialAuth {
    return value &&
        typeof value.userToken === "string";
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const circleAuth = body?.circleAuth;
        const email = isCircleSocialAuth(circleAuth) ? getCircleEmail(circleAuth) : "";

        if (!isCircleSocialAuth(circleAuth) || !email) {
            return NextResponse.json({ error: "Invalid completion payload" }, { status: 400 });
        }

        const wallets = await listCircleUserWallets(circleAuth.userToken);
        const wallet = selectArcEoaWallet(wallets);
        if (!wallet?.address) {
            return NextResponse.json({ error: "Circle wallet was not available after challenge completion" }, { status: 502 });
        }

        const walletAddress = wallet.address.toLowerCase();
        
        /* Check if this email is already registered to a different wallet address */
        const emailLower = email.toLowerCase().trim();
        const existingMapping = await withPgClient(async (client) => {
            return findAccountEmailBinding(client, emailLower);
        });

        if (isWalletOnlyEmailBinding(existingMapping)) {
            return NextResponse.json({
                error: "This email is linked to a wallet-only SubScript account. Connect that wallet to sign in."
            }, { status: 409 });
        }

        if (existingMapping && existingMapping.walletAddress !== walletAddress) {
            return NextResponse.json({
                error: "This email is already associated with another wallet account."
            }, { status: 409 });
        }

        await withPgClient(async (client) => {
            await client.query(
                `insert into user_embedded_wallets (
                    email,
                    wallet_address,
                    encrypted_private_key,
                    provider,
                    circle_wallet_id,
                    circle_user_id,
                    circle_blockchain,
                    google_subject,
                    updated_at
                ) values ($1, $2, null, 'circle_google', $3, $4, $5, $6, now())
                on conflict (email) do update set
                    wallet_address = excluded.wallet_address,
                    encrypted_private_key = null,
                    provider = excluded.provider,
                    circle_wallet_id = excluded.circle_wallet_id,
                    circle_user_id = excluded.circle_user_id,
                    circle_blockchain = excluded.circle_blockchain,
                    google_subject = excluded.google_subject,
                    updated_at = now()`,
                [
                    email,
                    walletAddress,
                    wallet.id || wallet.walletId || null,
                    circleAuth.oAuthInfo?.socialUserUUID || null,
                    wallet.blockchain || process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET",
                    circleAuth.oAuthInfo?.socialUserUUID || null,
                ]
            );
        });

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "JWT_SECRET is not configured" }, { status: 500 });
        }

        const role = await getAccountRole(walletAddress);

        const jwt = await new SignJWT({
            address: walletAddress,
            email,
            provider: "circle_google",
            authenticatedAt: Date.now(),
        })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("30d")
            .sign(new TextEncoder().encode(secretStr));

        const response = NextResponse.json({
            success: true,
            wallet: walletAddress,
            email,
            provider: "circle_google",
            role,
        });

        setSessionCookie(response, request, jwt, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

        return response;
    } catch (error: any) {
        console.error("Circle wallet completion error:", error);
        return NextResponse.json({ error: error.message || "Failed to complete Circle wallet setup" }, { status: 500 });
    }
}
