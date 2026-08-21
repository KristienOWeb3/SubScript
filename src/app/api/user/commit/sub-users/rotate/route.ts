import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import {
    CommitAccessError,
    isCommitId,
    resolveDisplayName,
    rotateSubUserCommitId,
} from "@/lib/commitId";

/* Re-issue a sub-user's Commit ID. The old one stops working the moment this returns.
 *
 * Sits alongside ../pause and ../revoke and follows their conventions exactly: session auth via
 * getSessionWallet, a shape check before the lookup so a malformed ID is a 400 rather than a 404
 * that implies the ID exists somewhere, and CommitAccessError carried through so 403, 404 and 409
 * stay distinct instead of collapsing into one code.
 *
 * Rotation is the answer to a leaked Commit ID. Revocation is the answer to a delegate you no
 * longer trust. Keeping them separate is the whole point: revocation is terminal, so using it for
 * a leak also spends the spend ledger and forces a re-onboard.
 */

/* Rate limited per account because rotation is the one commit mutation that can be used as a
   weapon. A parent could otherwise rotate on a loop and keep a delegate permanently unable to
   transact, and a stolen session could churn the ID faster than the holder can copy it. Lower than
   the 30/minute on pause and revoke: those are brakes worth spamming, and this is not. Five in a
   minute covers a fumbled retry and nothing more. */
const ROTATE_RATE_LIMIT = 5;
const ROTATE_RATE_WINDOW_SECONDS = 60;

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        /* Fails closed on a database incident, matching the sibling routes. The consequence is that
           rotation is briefly unavailable; pause remains open, so a leak still has an immediate
           answer while the limiter is down. */
        let rateLimit;
        try {
            rateLimit = await consumeDistributedRateLimit({
                scope: "user-commit-sub-user-rotate",
                key: walletAddress.toLowerCase(),
                limit: ROTATE_RATE_LIMIT,
                windowSeconds: ROTATE_RATE_WINDOW_SECONDS,
            });
        } catch (error) {
            console.error("Sub-user rotate limiter failed:", error);
            return NextResponse.json(
                { error: "We can't issue a new ID right now. Try again in a moment." },
                { status: 503, headers: { "Retry-After": "5" } },
            );
        }
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "You've issued a few new IDs already. Wait a minute and try again." },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }

        const body = await request.json().catch(() => ({}));
        const commitId = typeof body.commitId === "string" ? body.commitId.trim() : "";
        if (!commitId) {
            return NextResponse.json({ error: "A commit ID is required" }, { status: 400 });
        }
        if (!isCommitId(commitId)) {
            return NextResponse.json({ error: "That commit ID is not valid" }, { status: 400 });
        }

        const { previousCommitId, subUser } = await rotateSubUserCommitId(walletAddress, commitId);

        /* A claimed delegate has to be told, or they find out by having a payment refused on someone
           else's platform. We know their wallet, so an in-app notice lands without asking the parent
           to relay anything. An unclaimed invite has nobody to notify: the ID has never been handed
           over, so re-issuing it is just regenerating an invite.
           TODO(docs/email-audit.md): there is no email or DM for a re-credentialed delegate yet.
           This in-app notice is the whole channel until that audit's gaps are closed, so the
           dashboard also tells the parent to pass the new ID along themselves. */
        let delegateNotified = false;
        if (subUser.walletAddress) {
            try {
                await prisma.accountNotification.create({
                    data: {
                        recipientAddress: subUser.walletAddress,
                        audience: "USER",
                        title: "Your commit ID changed",
                        body: "The person who set up your spending access issued you a new commit ID. "
                            + "The old one has stopped working. Open your dashboard to copy the new one, "
                            + "then update anywhere you'd pasted it.",
                        url: "/dashboard/user",
                        source: "SYSTEM",
                    },
                });
                delegateNotified = true;
            } catch (error) {
                /* The rotation already happened and it is a security action, so a failed notice must
                   not roll it back or surface as an error. The response reports the miss and the UI
                   falls back to telling the parent to pass the ID on. */
                console.error("Failed to notify rotated sub-user:", error);
            }
        }

        return NextResponse.json({
            previousCommitId,
            commitId: subUser.commitId,
            status: subUser.status,
            displayName: resolveDisplayName(subUser),
            /* Null means the invite was never claimed, so this was a regenerated invite rather than
               a live person losing their credential. The UI words the confirmation off this. */
            walletAddress: subUser.walletAddress,
            commitIdRotatedAt: subUser.commitIdRotatedAt,
            delegateNotified,
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to rotate sub-user commit ID:", error);
        return NextResponse.json({ error: "Could not issue a new commit ID" }, { status: 500 });
    }
}
