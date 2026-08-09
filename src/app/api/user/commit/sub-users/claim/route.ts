import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { CommitAccessError, claimSubUser, isCommitId, resolveDisplayName } from "@/lib/commitId";

/* The invitee binds their own wallet. Authority is the caller's authenticated session, never the
   parent's request, so a wallet is only ever attached by whoever controls it. POST
   /api/user/commit/sub-users deliberately refuses to accept a wallet address for this reason. */
export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const commitId = typeof body.commitId === "string" ? body.commitId.trim() : "";

        /* Shape-check before the lookup so a malformed invite returns a precise 400 rather than
           a 400 that implies the sub-user exists somewhere. */
        if (!isCommitId(commitId)) {
            return NextResponse.json({ error: "That invite code is not valid" }, { status: 400 });
        }

        const subUser = await claimSubUser(walletAddress, commitId);
        if (!subUser) {
            return NextResponse.json({ error: "That invite is not valid" }, { status: 400 });
        }

        return NextResponse.json({
            subUser: {
                commitId: subUser.commitId,
                walletAddress: subUser.walletAddress,
                displayName: resolveDisplayName(subUser),
                status: subUser.status,
                spendLimitUsdc: subUser.spendLimitUsdc === null ? null : subUser.spendLimitUsdc.toString(),
                spentUsdc: subUser.spentUsdc.toString(),
            },
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to claim sub-user invite:", error);
        return NextResponse.json({ error: "Could not claim that invite" }, { status: 500 });
    }
}
