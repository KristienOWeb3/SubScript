import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { getOrCreateCommitForWallet, resolveDisplayName } from "@/lib/commitId";

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const commit = await getOrCreateCommitForWallet(walletAddress);

        return NextResponse.json({
            commitId: commit.commitId,
            displayName: resolveDisplayName(commit),
            commitIdRotatedAt: commit.commitIdRotatedAt,
            status: commit.status,
            createdAt: commit.createdAt,
        });
    } catch (error: any) {
        console.error("GET /api/user/commit error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to load Primary Commit ID" },
            { status: 500 }
        );
    }
}
