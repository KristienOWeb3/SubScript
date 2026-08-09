import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import { CommitAccessError, isCommitId } from "@/lib/commitId";
import { pauseVaultShare, resumeVaultShare, revokeVaultShare, withdrawVaultShare } from "@/lib/vaultCommitSharing";

/* Pause, resume, revoke and withdraw are one endpoint because they are one state machine on one column.
   Splitting them into three routes would triple the auth/limiter boilerplate for no gain. */
const ACTIONS = new Set(["pause", "resume", "revoke", "withdraw"]);

/* Revocation is the primary's emergency brake — a friend's Commit ID has leaked, or they are
   spending in a way the primary did not intend. It has to stay responsive under a burst, so the
   ceiling here is higher than the create/re-cap limit. */
const STATUS_RATE_LIMIT = 30;
const STATUS_RATE_WINDOW_SECONDS = 60;

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        /* Fails closed like the sibling routes. Note the consequence is only that revocation is
           briefly unavailable — spending is gated by the same DB, so a database incident does not
           leave a revoked share able to spend. */
        let rateLimit;
        try {
            rateLimit = await consumeDistributedRateLimit({
                scope: "user-vault-share-status",
                key: walletAddress.toLowerCase(),
                limit: STATUS_RATE_LIMIT,
                windowSeconds: STATUS_RATE_WINDOW_SECONDS,
            });
        } catch (error) {
            console.error("Vault share status limiter failed:", error);
            return NextResponse.json(
                { error: "This action is temporarily unavailable" },
                { status: 503, headers: { "Retry-After": "5" } },
            );
        }
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "Too many requests" },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }

        const body = await request.json().catch(() => ({}));

        if (!isCommitId(body.commitId)) {
            return NextResponse.json({ error: "A valid commitId is required" }, { status: 400 });
        }
        if (typeof body.action !== "string" || !ACTIONS.has(body.action)) {
            return NextResponse.json(
                { error: "action must be one of: pause, resume, revoke, withdraw" },
                { status: 400 },
            );
        }

        const action = body.action as "pause" | "resume" | "revoke" | "withdraw";
        const share = action === "pause"
            ? await pauseVaultShare(walletAddress, body.commitId)
            : action === "resume"
                ? await resumeVaultShare(walletAddress, body.commitId)
                : action === "withdraw"
                    ? await withdrawVaultShare(walletAddress, body.commitId)
                    : await revokeVaultShare(walletAddress, body.commitId);

        return NextResponse.json({
            commitId: share.commitId,
            status: share.status,
            pausedAt: share.pausedAt,
            revokedAt: share.revokedAt,
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to update vault share status:", error);
        return NextResponse.json({ error: "Could not update this share" }, { status: 500 });
    }
}
