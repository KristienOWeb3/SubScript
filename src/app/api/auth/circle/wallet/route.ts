import { NextResponse } from "next/server";
import { createCircleArcWalletChallenge, getCircleEmail, type CircleSocialAuth } from "@/lib/circle/client";
import { pgMaybeOne, withPgClient } from "@/lib/serverPg";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";

function isCircleSocialAuth(value: any): value is CircleSocialAuth {
    return value &&
        typeof value.userToken === "string";
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const circleAuth = body?.circleAuth;
        const authIntent = body?.authIntent === "signin" ? "signin" : "signup";
        if (!isCircleSocialAuth(circleAuth)) {
            return NextResponse.json({ error: "Invalid Circle social auth payload" }, { status: 400 });
        }

        const email = getCircleEmail(circleAuth);
        if (!email) {
            return NextResponse.json({ error: "Circle Google login did not return an email" }, { status: 400 });
        }

        const existingWallet = await withPgClient((client) => findAccountEmailBinding(client, email.toLowerCase()));

        if (isWalletOnlyEmailBinding(existingWallet)) {
            return NextResponse.json({
                error: "This email is linked to a wallet-only SubScript account. Connect that wallet to sign in.",
                redirectTo: "/signin",
            }, { status: 409 });
        }

        let existingRole: { role: string } | null = null;
        if (existingWallet) {
            existingRole = await pgMaybeOne<{ role: string }>(
                "select role from account_roles where address = $1 limit 1",
                [existingWallet.walletAddress]
            );
        }

        if (authIntent === "signup" && existingRole) {
            return NextResponse.json({
                error: "An account with this Google email already exists. Continue from Sign In.",
                redirectTo: `/signin?email=${encodeURIComponent(email)}`,
            }, { status: 409 });
        }

        if (authIntent === "signin" && !existingRole) {
            return NextResponse.json({
                error: "No SubScript account exists for this Google email yet. Create one from Sign Up.",
                redirectTo: `/signup?email=${encodeURIComponent(email)}`,
            }, { status: 404 });
        }

        if (existingWallet) {
            return NextResponse.json({
                requiresChallenge: false,
                email,
                role: existingRole?.role || null,
            });
        }

        const challenge = await createCircleArcWalletChallenge(circleAuth.userToken);
        const challengeId = challenge.data?.challengeId;
        if (!challengeId) {
            return NextResponse.json({ error: "Circle did not return a wallet challenge" }, { status: 502 });
        }

        return NextResponse.json({
            requiresChallenge: true,
            challengeId,
            email,
        });
    } catch (error: any) {
        console.error("Circle wallet challenge error:", error);
        return NextResponse.json({ error: error.message || "Failed to create Circle wallet challenge" }, { status: 500 });
    }
}
