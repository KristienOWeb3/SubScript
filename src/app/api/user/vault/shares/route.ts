import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import { CommitAccessError, isCommitId, resolveDisplayName } from "@/lib/commitId";
import {
    MAX_SHARES_PER_VAULT,
    createVaultShare,
    listVaultShares,
    updateVaultShareLimit,
} from "@/lib/vaultCommitSharing";

/* Same BigInt-as-string convention as /api/user/commit/sub-users: USDC columns are BIGINT micros
   and JSON.stringify cannot carry them, so they leave as decimal strings. */
function serializeShare(share: {
    commitId: string;
    displayName: string | null;
    status: string;
    spendLimitUsdc: bigint | null;
    spentUsdc: bigint;
    pausedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}) {
    return {
        commitId: share.commitId,
        displayName: resolveDisplayName({
            commitId: share.commitId,
            displayName: share.displayName,
            walletAddress: null,
        }),
        status: share.status,
        spendLimitUsdc: share.spendLimitUsdc === null ? null : share.spendLimitUsdc.toString(),
        spentUsdc: share.spentUsdc.toString(),
        remainingUsdc:
            share.spendLimitUsdc === null
                ? null
                : (share.spendLimitUsdc > share.spentUsdc
                    ? share.spendLimitUsdc - share.spentUsdc
                    : BigInt(0)
                  ).toString(),
        pausedAt: share.pausedAt,
        revokedAt: share.revokedAt,
        createdAt: share.createdAt,
    };
}

const MAX_DISPLAY_NAME_LENGTH = 128;
/* Sharing escrow is an administrative act. Bounded per minute so a stolen session cannot burn
   every slot in one burst, keyed by wallet because the route is authenticated. */
const WRITE_RATE_LIMIT = 10;
const WRITE_RATE_WINDOW_SECONDS = 60;

async function guardWriteRate(walletAddress: string) {
    /* Fails closed, matching the sub-user routes: an unavailable limiter must not silently become
       no limiter on a route that hands out spend authority over real escrow. */
    try {
        const rateLimit = await consumeDistributedRateLimit({
            scope: "user-vault-share-write",
            key: walletAddress.toLowerCase(),
            limit: WRITE_RATE_LIMIT,
            windowSeconds: WRITE_RATE_WINDOW_SECONDS,
        });
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "Too many share requests" },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }
        return null;
    } catch (error) {
        console.error("Vault share limiter failed:", error);
        return NextResponse.json(
            { error: "Sharing is temporarily unavailable" },
            { status: 503, headers: { "Retry-After": "5" } },
        );
    }
}

function parseVaultId(value: unknown) {
    return typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value) ? value : null;
}

/* Caps arrive as decimal micro-USDC strings. `undefined` means "not supplied"; an explicit null
   means "uncapped" — a distinction the create path rejects (an uncapped friend could drain the
   whole escrow) but the re-cap path accepts. */
function parseSpendLimit(raw: unknown): { ok: true; value: bigint | null } | { ok: false; error: string } {
    if (raw === undefined) return { ok: true, value: null };
    if (raw === null || raw === "") return { ok: true, value: null };
    const text = String(raw);
    if (!/^\d+$/.test(text)) return { ok: false, error: "Spend cap must be a whole number of micro-USDC" };
    const value = BigInt(text);
    if (value <= BigInt(0)) return { ok: false, error: "Spend cap must be greater than zero" };
    return { ok: true, value };
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const vaultId = parseVaultId(new URL(request.url).searchParams.get("vaultId"));
        if (!vaultId) {
            return NextResponse.json({ error: "A valid vaultId is required" }, { status: 400 });
        }

        const result = await listVaultShares(walletAddress, vaultId);
        return NextResponse.json({
            vaultId,
            rootCommitId: result.rootCommitId,
            escrowUsdc: result.escrowUsdc.toString(),
            allocatedUsdc: result.allocatedUsdc.toString(),
            unallocatedUsdc: result.unallocatedUsdc.toString(),
            maxShares: MAX_SHARES_PER_VAULT,
            shares: result.shares.map(serializeShare),
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to load vault shares:", error);
        return NextResponse.json({ error: "Could not load shares" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const limited = await guardWriteRate(walletAddress);
        if (limited) return limited;

        const body = await request.json().catch(() => ({}));

        const vaultId = parseVaultId(body.vaultId);
        if (!vaultId) {
            return NextResponse.json({ error: "A valid vaultId is required" }, { status: 400 });
        }

        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : null;
        if (displayName && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
            return NextResponse.json(
                { error: `Name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer` },
                { status: 400 },
            );
        }

        const parsed = parseSpendLimit(body.spendLimitUsdc);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        /* A cap is mandatory when creating a share. The whole point of handing a Commit ID to a
           friend is that they cannot spend past a number the primary chose; an uncapped friend
           would be able to drain the entire committed escrow. */
        if (parsed.value === null) {
            return NextResponse.json({ error: "A spend cap is required when sharing" }, { status: 400 });
        }

        const share = await createVaultShare({
            userAddress: walletAddress,
            vaultId,
            displayName,
            spendLimitUsdc: parsed.value,
        });

        return NextResponse.json({ share: serializeShare(share) }, { status: 201 });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to create vault share:", error);
        return NextResponse.json({ error: "Could not share this commitment" }, { status: 500 });
    }
}

/* Re-cap an existing share. Accepts an explicit null to mean "remove the cap", which the create
   path forbids — raising or lowering a number for someone already trusted is a smaller act than
   handing out uncapped authority at invite time. */
export async function PATCH(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const limited = await guardWriteRate(walletAddress);
        if (limited) return limited;

        const body = await request.json().catch(() => ({}));

        if (!isCommitId(body.commitId)) {
            return NextResponse.json({ error: "A valid commitId is required" }, { status: 400 });
        }
        if (!("spendLimitUsdc" in body)) {
            return NextResponse.json({ error: "spendLimitUsdc is required" }, { status: 400 });
        }

        const parsed = parseSpendLimit(body.spendLimitUsdc);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const share = await updateVaultShareLimit(walletAddress, body.commitId, parsed.value);

        return NextResponse.json({ share: serializeShare(share) });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to update vault share:", error);
        return NextResponse.json({ error: "Could not update this share" }, { status: 500 });
    }
}
