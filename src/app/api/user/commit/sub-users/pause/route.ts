import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { CommitAccessError, pauseSubUser, resumeSubUser } from "@/lib/commitId";

async function readCommitId(request: Request): Promise<string | null> {
    const body = await request.json().catch(() => ({}));
    const commitId = typeof body.commitId === "string" ? body.commitId.trim() : "";
    return commitId || null;
}

// POST pauses the sub-user; DELETE lifts the pause. Both are reversible by design — the
// terminal action lives at ../revoke.
export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const commitId = await readCommitId(request);
        if (!commitId) {
            return NextResponse.json({ error: "A commit ID is required" }, { status: 400 });
        }

        const subUser = await pauseSubUser(walletAddress, commitId);
        return NextResponse.json({ commitId: subUser.commitId, status: subUser.status });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        console.error("Failed to pause sub-user:", error);
        return NextResponse.json({ error: "Could not pause sub-user" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const commitId = await readCommitId(request);
        if (!commitId) {
            return NextResponse.json({ error: "A commit ID is required" }, { status: 400 });
        }

        const subUser = await resumeSubUser(walletAddress, commitId);
        return NextResponse.json({ commitId: subUser.commitId, status: subUser.status });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        console.error("Failed to resume sub-user:", error);
        return NextResponse.json({ error: "Could not resume sub-user" }, { status: 500 });
    }
}
