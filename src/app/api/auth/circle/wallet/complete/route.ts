import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { listCircleUserWallets, selectArcEoaWallet, type CircleSocialAuth } from "@/lib/circle/client";

function isCircleSocialAuth(value: any): value is CircleSocialAuth {
    return value &&
        typeof value.userToken === "string" &&
        typeof value.encryptionKey === "string";
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const circleAuth = body?.circleAuth;
        const email = typeof body?.email === "string" ? body.email.toLowerCase() : "";

        if (!isCircleSocialAuth(circleAuth) || !email) {
            return NextResponse.json({ error: "Invalid completion payload" }, { status: 400 });
        }
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase service client is not configured" }, { status: 500 });
        }

        const wallets = await listCircleUserWallets(circleAuth.userToken);
        const wallet = selectArcEoaWallet(wallets);
        if (!wallet?.address) {
            return NextResponse.json({ error: "Circle wallet was not available after challenge completion" }, { status: 502 });
        }

        const walletAddress = wallet.address.toLowerCase();
        await supabaseAdmin
            .from("user_embedded_wallets")
            .upsert({
                email,
                wallet_address: walletAddress,
                encrypted_private_key: null,
                provider: "circle_google",
                circle_wallet_id: wallet.id || wallet.walletId || null,
                circle_user_id: circleAuth.oAuthInfo?.socialUserUUID || null,
                circle_blockchain: wallet.blockchain || process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET",
                google_subject: circleAuth.oAuthInfo?.socialUserUUID || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: "email" });

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "JWT_SECRET is not configured" }, { status: 500 });
        }

        const roleRecord = await prisma.accountRole.findUnique({
            where: { address: walletAddress },
        }).catch(() => null);

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
            role: roleRecord?.role || null,
        });

        response.cookies.set("subscript_session_token", jwt, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return response;
    } catch (error: any) {
        console.error("Circle wallet completion error:", error);
        return NextResponse.json({ error: error.message || "Failed to complete Circle wallet setup" }, { status: 500 });
    }
}
