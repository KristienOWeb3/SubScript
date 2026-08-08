import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import {
    CommitAccessError,
    createSubUser,
    getOrCreateCommitForWallet,
    listSubUsers,
    resolveDisplayName,
} from "@/lib/commitId";

/* BigInt can't go through JSON.stringify, so USDC columns leave as decimal strings and the
   client parses them. Keeping them as strings also avoids float rounding on large caps. */
function serializeSubUser(subUser: {
    commitId: string;
    walletAddress: string | null;
    displayName: string | null;
    status: string;
    spendLimitUsdc: bigint | null;
    spentUsdc: bigint;
    pausedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}) {
    return {
        commitId: subUser.commitId,
        walletAddress: subUser.walletAddress,
        displayName: resolveDisplayName(subUser),
        status: subUser.status,
        spendLimitUsdc: subUser.spendLimitUsdc === null ? null : subUser.spendLimitUsdc.toString(),
        spentUsdc: subUser.spentUsdc.toString(),
        remainingUsdc:
            subUser.spendLimitUsdc === null
                ? null
                : (subUser.spendLimitUsdc - subUser.spentUsdc).toString(),
        pausedAt: subUser.pausedAt,
        revokedAt: subUser.revokedAt,
        createdAt: subUser.createdAt,
    };
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const commit = await getOrCreateCommitForWallet(walletAddress);
        const subUsers = await listSubUsers(walletAddress);

        return NextResponse.json({
            commitId: commit.commitId,
            displayName: resolveDisplayName(commit),
            subUsers: subUsers.map(serializeSubUser),
        });
    } catch (error) {
        console.error("Failed to load sub-users:", error);
        return NextResponse.json({ error: "Could not load sub-users" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const displayName = typeof body.displayName === "string" ? body.displayName : null;
        const subWallet = typeof body.walletAddress === "string" ? body.walletAddress.trim() : null;

        if (subWallet && !/^0x[a-fA-F0-9]{40}$/.test(subWallet)) {
            return NextResponse.json({ error: "That wallet address is not valid" }, { status: 400 });
        }

        /* Caps arrive as decimal strings for the same BigInt reason as above. Reject anything
           non-numeric outright instead of letting BigInt() throw a bare SyntaxError. */
        let spendLimitUsdc: bigint | null = null;
        if (body.spendLimitUsdc !== undefined && body.spendLimitUsdc !== null && body.spendLimitUsdc !== "") {
            const raw = String(body.spendLimitUsdc);
            if (!/^\d+$/.test(raw)) {
                return NextResponse.json({ error: "Spend limit must be a whole number" }, { status: 400 });
            }
            spendLimitUsdc = BigInt(raw);
        }

        const subUser = await createSubUser({
            parentWalletAddress: walletAddress,
            displayName,
            walletAddress: subWallet,
            spendLimitUsdc,
        });

        return NextResponse.json({ subUser: serializeSubUser(subUser) }, { status: 201 });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("Failed to create sub-user:", error);
        return NextResponse.json({ error: "Could not create sub-user" }, { status: 500 });
    }
}
