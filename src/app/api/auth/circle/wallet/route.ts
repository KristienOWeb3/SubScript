import { NextResponse } from "next/server";
import { createCircleArcWalletChallenge, getCircleEmail, type CircleSocialAuth } from "@/lib/circle/client";
import { prisma } from "@/lib/prisma";

function isCircleSocialAuth(value: any): value is CircleSocialAuth {
    return value &&
        typeof value.userToken === "string" &&
        typeof value.encryptionKey === "string";
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

        const existingWallet = await prisma.userEmbeddedWallet.findUnique({
            where: { email: email.toLowerCase() },
            select: { walletAddress: true },
        }).catch(() => null);
        const existingRole = existingWallet
            ? await prisma.accountRole.findUnique({
                where: { address: existingWallet.walletAddress.toLowerCase() },
                select: { role: true },
            }).catch(() => null)
            : null;

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

        const challenge = await createCircleArcWalletChallenge(circleAuth.userToken);
        const challengeId = challenge.data?.challengeId;
        if (!challengeId) {
            return NextResponse.json({ error: "Circle did not return a wallet challenge" }, { status: 502 });
        }

        return NextResponse.json({
            challengeId,
            email,
            userToken: circleAuth.userToken,
            encryptionKey: circleAuth.encryptionKey,
        });
    } catch (error: any) {
        console.error("Circle wallet challenge error:", error);
        return NextResponse.json({ error: error.message || "Failed to create Circle wallet challenge" }, { status: 500 });
    }
}
