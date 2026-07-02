import { after, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { DmGameError } from "./errors";
import { relaySettlementFromKeeper } from "./onchain";
import { updateGameSettlement, type DmGameRecord } from "./service";

export async function requireDmGameUser(headers: Headers) {
    const wallet = await getSessionWallet(headers);
    if (!wallet) {
        return {
            wallet: null,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
    }
    const role = await requireAccountRole(wallet, "USER");
    if (!role.ok) {
        return {
            wallet: null,
            response: NextResponse.json({ error: role.error }, { status: role.status }),
        };
    }
    return { wallet: wallet.toLowerCase(), response: null };
}

/**
 * When a game finalizes, have the keeper (referee) relay the signed settlement on-chain right
 * away instead of waiting for the winner to submit it. This runs after the response is sent and
 * is best-effort: the cron in /api/cron/games-timeout is the backstop if it fails. It's the main
 * mitigation for the claimTimeout seizure window (the escrow contract never advances currentTurn,
 * so a permissionless claimTimeout otherwise pays Black regardless of the real result).
 */
export function scheduleKeeperSettlement(game: DmGameRecord) {
    const finished = game.status === "WHITE_WON" || game.status === "BLACK_WON" || game.status === "DRAW";
    if (!finished || game.mode !== "testnet" || !game.contractGameId) return;
    if (game.settlementStatus === "SETTLED") return;

    after(async () => {
        try {
            const txHash = await relaySettlementFromKeeper({
                contractGameId: game.contractGameId,
                status: game.status,
                whiteAddress: game.whiteAddress,
                blackAddress: game.blackAddress,
                fen: game.fen,
            });
            if (txHash) await updateGameSettlement({ gameId: game.id, txHash });
        } catch (err) {
            console.error(`[games] keeper settlement relay failed for game ${game.id}:`, err);
        }
    });
}

export function dmGameErrorResponse(error: unknown, operation: string) {
    if (error instanceof DmGameError) {
        return NextResponse.json(
            { error: error.message, code: error.code },
            { status: error.status },
        );
    }
    console.error(`DM game ${operation} failed:`, error);
    return NextResponse.json(
        { error: `Failed to ${operation} game` },
        { status: 500 },
    );
}

