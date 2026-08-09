import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { CommitAccessError, isCommitId, revokeSubUser } from "@/lib/commitId";

/* Terminal: a revoked sub-user can never be reactivated (see setSubUserStatus). The parent
   has to issue a new delegation, which starts spend tracking from zero. */
export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const commitId = typeof body.commitId === "string" ? body.commitId.trim() : "";
        if (!commitId) {
            return NextResponse.json({ error: "A commit ID is required" }, { status: 400 });
        }
        /* Shape-check before the lookup so a malformed ID returns a precise 400 instead of a
           404 that implies the sub-user exists somewhere. */
        if (!isCommitId(commitId)) {
            return NextResponse.json({ error: "That commit ID is not valid" }, { status: 400 });
        }

        const subUser = await revokeSubUser(walletAddress, commitId);
        return NextResponse.json({ commitId: subUser.commitId, status: subUser.status });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to revoke sub-user:", error);
        return NextResponse.json({ error: "Could not revoke sub-user" }, { status: 500 });
    }
}
