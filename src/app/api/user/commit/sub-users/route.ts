import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
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

/* Bounded so a single caller cannot store unbounded text or an absurd cap. The column is plain
   TEXT with no length CHECK, so this handler is the only thing standing between a client and a
   multi-megabyte display name. 128 chars is generous for a human label. */
const MAX_DISPLAY_NAME_LENGTH = 128;
/* 10 billion USDC in 6-decimal micros: far above any real delegation, low enough that the value
   stays inside BIGINT once spent_usdc accumulates against it. */
const MAX_SPEND_LIMIT_USDC = 10_000_000_000_000_000n;
/* Delegation is an administrative act, not a bulk one. A ceiling keeps a compromised session
   from inflating the table and makes the listing endpoint's unbounded read safe. */
const MAX_SUB_USERS_PER_PARENT = 100;

/* The per-parent ceiling above bounds the steady state; this bounds the rate of approach to it.
   Without it a stolen session can burn all 100 slots in one burst, and every rejected attempt
   past the ceiling still costs a listSubUsers read. Keyed by wallet rather than IP because the
   route is authenticated — the wallet is the thing being protected. */
const CREATE_RATE_LIMIT = 10;
const CREATE_RATE_WINDOW_SECONDS = 60;

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        /* Fails closed on a database incident, matching the payment-status routes: an unavailable
           limiter must not silently become no limiter on a route that writes spend authority. */
        let rateLimit;
        try {
            rateLimit = await consumeDistributedRateLimit({
                scope: "user-commit-sub-user-create",
                key: walletAddress.toLowerCase(),
                limit: CREATE_RATE_LIMIT,
                windowSeconds: CREATE_RATE_WINDOW_SECONDS,
            });
        } catch (error) {
            console.error("Sub-user create limiter failed:", error);
            return NextResponse.json(
                { error: "Sub-user creation is temporarily unavailable" },
                { status: 503, headers: { "Retry-After": "5" } },
            );
        }
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "Too many sub-user creation requests" },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }

        const body = await request.json().catch(() => ({}));
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : null;

        if (displayName && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
            return NextResponse.json(
                { error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer` },
                { status: 400 },
            );
        }

        /* Wallet binding is deliberately not accepted here. Letting a parent name someone else's
           address would reserve it under the unique constraint, so the victim's own first sign-in
           would resolve to this delegated row instead of a fresh root commit. The invitee binds
           their own wallet through POST /api/user/commit/sub-users/claim. */
        if (body.walletAddress !== undefined && body.walletAddress !== null && body.walletAddress !== "") {
            return NextResponse.json(
                { error: "A sub-user binds their own wallet by claiming the invite" },
                { status: 400 },
            );
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
            if (spendLimitUsdc > MAX_SPEND_LIMIT_USDC) {
                return NextResponse.json({ error: "That spend limit is too large" }, { status: 400 });
            }
        }

        const existing = await listSubUsers(walletAddress);
        if (existing.length >= MAX_SUB_USERS_PER_PARENT) {
            return NextResponse.json(
                { error: `You can have at most ${MAX_SUB_USERS_PER_PARENT} sub-users` },
                { status: 400 },
            );
        }

        const subUser = await createSubUser({
            parentWalletAddress: walletAddress,
            displayName,
            spendLimitUsdc,
        });

        return NextResponse.json({ subUser: serializeSubUser(subUser) }, { status: 201 });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to create sub-user:", error);
        return NextResponse.json({ error: "Could not create sub-user" }, { status: 500 });
    }
}
