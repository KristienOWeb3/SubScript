import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { rotateRootCommitForWallet } from "@/lib/commitId";

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const { previousCommitId, commit } = await rotateRootCommitForWallet(walletAddress);

        return NextResponse.json({
            success: true,
            previousCommitId,
            commitId: commit.commitId,
            commitIdRotatedAt: commit.commitIdRotatedAt,
            status: commit.status,
        });
    } catch (error: any) {
        console.error("POST /api/user/commit/rotate error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to rotate Primary Commit ID" },
            { status: error?.httpStatus || 500 }
        );
    }
}
