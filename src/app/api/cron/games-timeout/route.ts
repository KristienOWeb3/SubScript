import { NextResponse } from "next/server";
import {
    settleExpiredDmGames,
    listGamesAwaitingOnchainSettlement,
    updateGameSettlement,
    expireStaleInvites,
    markInviteRefunded,
} from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
import {
    relaySettlementFromKeeper,
    cancelUnjoinedGameFromEmbedded,
    walletHasEmbeddedKey,
} from "@/lib/games/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
    const keeperSecret = process.env.KEEPER_SECRET;
    const cronSecret = process.env.CRON_SECRET;
    if (!keeperSecret && !cronSecret) return null;

    const authorization = request.headers.get("authorization");
    const presented = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;

    return Boolean(
        presented
        && (
            (keeperSecret && presented === keeperSecret)
            || (cronSecret && presented === cronSecret)
        )
    );
}

async function settleExpiredGames(request: Request) {
    try {
        const authorized = isAuthorized(request);
        if (authorized === null) {
            return NextResponse.json(
                { error: "Internal Server Error: KEEPER_SECRET or CRON_SECRET must be configured" },
                { status: 500 },
            );
        }
        if (!authorized) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();

        /* 1. DB-settle games whose 24h clock expired (records the winner/timeout result). */
        const settled = await settleExpiredDmGames(now, 100);

        /* 2. Relay any decided-but-unsettled result on-chain as the keeper (referee), so a
              winner is never exposed to the permissionless claimTimeout seizure window. Reverts
              (already settled / claimed) are swallowed — this is a best-effort backstop. */
        const config = getDmGamesConfig();
        const relayed: string[] = [];
        if (config.enabled && config.mode === "testnet" && config.contractAddress) {
            const awaiting = await listGamesAwaitingOnchainSettlement(50);
            for (const game of awaiting) {
                if (!game.contractGameId) continue;
                try {
                    const txHash = await relaySettlementFromKeeper({
                        contractGameId: game.contractGameId,
                        status: game.status,
                        whiteAddress: game.whiteAddress,
                        blackAddress: game.blackAddress,
                        fen: game.fen,
                    });
                    if (txHash) {
                        await updateGameSettlement({ gameId: game.id, txHash });
                        relayed.push(game.id);
                    }
                } catch (err) {
                    console.error(`[games-timeout] settlement relay failed for game ${game.id}:`, err);
                }
            }
        }

        /* 3. Cancel invitations that expired before anyone joined, and reclaim the creator's
              on-chain escrow when they funded from a server-held (embedded) wallet. */
        const expiredInvites = await expireStaleInvites(now, 50);
        const refunded: string[] = [];
        if (config.enabled && config.mode === "testnet" && config.contractAddress) {
            for (const game of expiredInvites) {
                if (!game.creatorStakeTxHash || !game.contractGameId) continue;
                try {
                    if (!(await walletHasEmbeddedKey(game.creatorAddress))) continue;
                    const txHash = await cancelUnjoinedGameFromEmbedded({
                        walletAddress: game.creatorAddress,
                        escrowAddress: config.contractAddress,
                        contractGameId: game.contractGameId,
                    });
                    await markInviteRefunded({ gameId: game.id, txHash });
                    refunded.push(game.id);
                } catch (err) {
                    console.error(`[games-timeout] invite escrow reclaim failed for game ${game.id}:`, err);
                }
            }
        }

        return NextResponse.json({
            success: true,
            processed: settled.length,
            gameIds: settled.map((game) => game.id),
            relayedSettlements: relayed,
            expiredInvites: expiredInvites.map((game) => game.id),
            refundedInvites: refunded,
        });
    } catch (error) {
        console.error("Failed to settle expired DM games:", error);
        return NextResponse.json(
            { error: "Failed to settle expired games" },
            { status: 500 },
        );
    }
}

export async function GET(request: Request) {
    return settleExpiredGames(request);
}

export async function POST(request: Request) {
    return settleExpiredGames(request);
}
