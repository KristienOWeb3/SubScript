import crypto from "node:crypto";
// @ts-ignore
import type { PoolClient } from "pg";
import { ethers } from "ethers";
import { withPgClient } from "@/lib/serverPg";
import type { ApplyChessMoveResult, PromotionPiece } from "./chess";
import { applyChessMove, INITIAL_FEN, positionKey } from "./chess";
import { CHECKERS_INITIAL_FEN } from "./checkers";
import type { ReturnTypeOfGetDmGamesConfig } from "./types";
import {
    gameBadRequest,
    gameConflict,
    gameForbidden,
    gameNotFound,
} from "./errors";
import { calculateGameEconomics } from "./money";

const ACTIVE_STATUSES = ["INVITED", "ACTIVE"] as const;

export type DmGameRecord = {
    id: string;
    contractGameId: string;
    gameType: string;
    mode: string;
    status: string;
    settlementStatus: string;
    creatorAddress: string;
    opponentAddress: string | null;
    whiteAddress: string | null;
    blackAddress: string | null;
    stakePerPlayerUsdc: bigint;
    feeBps: number;
    treasuryAddress: string;
    chainId: number;
    contractAddress: string | null;
    currentTurnAddress: string | null;
    fen: string;
    positionHistory: string[];
    ply: number;
    version: number;
    inviteExpiresAt: Date;
    startedAt: Date | null;
    expiresAt: Date | null;
    completedAt: Date | null;
    winnerAddress: string | null;
    resultReason: string | null;
    creatorStakeTxHash: string | null;
    opponentStakeTxHash: string | null;
    settlementTxHash: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type DbGameRow = {
    id: string;
    contract_game_id: string;
    game_type: string;
    mode: string;
    status: string;
    settlement_status: string;
    creator_address: string;
    opponent_address: string | null;
    white_address: string | null;
    black_address: string | null;
    stake_per_player_usdc: string | bigint;
    fee_bps: number;
    treasury_address: string;
    chain_id: number;
    contract_address: string | null;
    current_turn_address: string | null;
    fen: string;
    position_history: unknown;
    ply: number;
    version: number;
    invite_expires_at: Date | string;
    started_at: Date | string | null;
    expires_at: Date | string | null;
    completed_at: Date | string | null;
    winner_address: string | null;
    result_reason: string | null;
    creator_stake_tx_hash: string | null;
    opponent_stake_tx_hash: string | null;
    settlement_tx_hash: string | null;
    created_at: Date | string;
    updated_at: Date | string;
};

function asDate(value: Date | string | null): Date | null {
    return value === null ? null : value instanceof Date ? value : new Date(value);
}

function normalizeHistory(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

export function mapDmGameRow(row: DbGameRow): DmGameRecord {
    return {
        id: row.id,
        contractGameId: row.contract_game_id,
        gameType: row.game_type,
        mode: row.mode,
        status: row.status,
        settlementStatus: row.settlement_status,
        creatorAddress: row.creator_address,
        opponentAddress: row.opponent_address,
        whiteAddress: row.white_address,
        blackAddress: row.black_address,
        stakePerPlayerUsdc: BigInt(row.stake_per_player_usdc),
        feeBps: row.fee_bps,
        treasuryAddress: row.treasury_address,
        chainId: row.chain_id,
        contractAddress: row.contract_address,
        currentTurnAddress: row.current_turn_address,
        fen: row.fen,
        positionHistory: normalizeHistory(row.position_history),
        ply: row.ply,
        version: row.version,
        inviteExpiresAt: asDate(row.invite_expires_at)!,
        startedAt: asDate(row.started_at),
        expiresAt: asDate(row.expires_at),
        completedAt: asDate(row.completed_at),
        winnerAddress: row.winner_address,
        resultReason: row.result_reason,
        creatorStakeTxHash: row.creator_stake_tx_hash,
        opponentStakeTxHash: row.opponent_stake_tx_hash,
        settlementTxHash: row.settlement_tx_hash,
        createdAt: asDate(row.created_at)!,
        updatedAt: asDate(row.updated_at)!,
    };
}

async function serializable<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await withPgClient(async (client) => {
                await client.query("begin isolation level serializable");
                try {
                    const result = await operation(client);
                    await client.query("commit");
                    return result;
                } catch (error) {
                    await client.query("rollback");
                    throw error;
                }
            });
        } catch (error: any) {
            lastError = error;
            if (!["40001", "40P01"].includes(error?.code) || attempt === 2) throw error;
        }
    }
    throw lastError;
}

async function insertGameEvent(
    client: PoolClient,
    input: {
        gameId: string;
        eventKey: string;
        eventType: string;
        actor?: string | null;
        payload: Record<string, unknown>;
    },
) {
    await client.query(
        `insert into dm_game_events (game_id, event_key, event_type, actor, payload)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (event_key) do nothing`,
        [
            input.gameId,
            input.eventKey,
            input.eventType,
            input.actor || null,
            JSON.stringify(input.payload),
        ],
    );
}

async function insertGameDm(
    client: PoolClient,
    input: {
        gameId: string;
        eventKey: string;
        sender: string;
        receiver: string;
        messageType: "GAME_INVITE" | "GAME_STARTED" | "GAME_RESULT";
        title: string;
        description: string;
        amountUsdc?: bigint;
    },
) {
    await client.query(
        `insert into subscript_dms (
            sender_address,
            receiver_address,
            message_type,
            status,
            amount_usdc,
            title,
            description,
            dm_game_id,
            game_event_key
         ) values ($1, $2, $3, 'APPROVED', $4, $5, $6, $7, $8)
         on conflict (game_event_key) do nothing`,
        [
            input.sender,
            input.receiver,
            input.messageType,
            input.amountUsdc?.toString() || null,
            input.title,
            input.description,
            input.gameId,
            input.eventKey,
        ],
    );
}

export async function createDmGame(input: {
    creatorAddress: string;
    opponentAddress: string | null;
    stakePerPlayerUsdc: bigint;
    gameType?: string;
    config: ReturnTypeOfGetDmGamesConfig;
    now?: Date;
}) {
    const creator = input.creatorAddress.toLowerCase();
    const opponent = input.opponentAddress?.trim().toLowerCase() || null;
    const now = input.now || new Date();
    const config = input.config;

    if (opponent && (!ethers.isAddress(opponent) || opponent === creator)) {
        throw gameBadRequest("Opponent must be a different valid wallet address", "INVALID_OPPONENT");
    }
    if (
        input.stakePerPlayerUsdc < config.minimumStakeMicros
        || input.stakePerPlayerUsdc > config.maximumStakeMicros
    ) {
        throw gameBadRequest(
            `Stake must be between ${config.minimumStakeMicros} and ${config.maximumStakeMicros} micro-USDC`,
            "STAKE_OUT_OF_RANGE",
        );
    }

    const id = crypto.randomUUID();
    const contractGameId = ethers.keccak256(ethers.toUtf8Bytes(`subscript:dm-game:${id}`));
    const inviteExpiresAt = new Date(now.getTime() + config.inviteTtlMs);
    const gameType = (input.gameType || "CHESS").toUpperCase();
    if (gameType !== "CHESS" && gameType !== "CHECKERS") {
        throw gameBadRequest("Invalid game type", "INVALID_GAME_TYPE");
    }
    const initialFen = gameType === "CHECKERS" ? CHECKERS_INITIAL_FEN : INITIAL_FEN;
    const history = [positionKey(initialFen)];
    const economics = calculateGameEconomics(input.stakePerPlayerUsdc);

    return serializable(async (client) => {
        const role = await client.query<{ role: string }>(
            "select role from account_roles where address = $1 limit 1",
            [creator],
        );
        if (role.rows[0]?.role !== "USER") {
            throw gameForbidden("Only USER accounts can host peer games", "USER_ROLE_REQUIRED");
        }

        if (opponent) {
            const opponentRole = await client.query<{ role: string }>(
                "select role from account_roles where address = $1 limit 1",
                [opponent],
            );
            if (opponentRole.rows[0]?.role !== "USER") {
                throw gameForbidden("Games can only be hosted with another USER account", "PEER_USER_REQUIRED");
            }
            const thread = await client.query(
                `select id from subscript_dms
                 where (sender_address = $1 and receiver_address = $2)
                    or (sender_address = $2 and receiver_address = $1)
                 limit 1`,
                [creator, opponent],
            );
            if (!thread.rowCount) {
                throw gameForbidden(
                    "Open a peer DM before creating a receiver-bound game",
                    "DM_THREAD_REQUIRED",
                );
            }
        }

        const openCount = await client.query<{ count: string }>(
            `select count(*)::text as count
             from dm_games
             where (creator_address = $1 or opponent_address = $1)
               and status = any($2::text[])`,
            [creator, [...ACTIVE_STATUSES]],
        );
        if (Number(openCount.rows[0]?.count || "0") >= config.maximumOpenGamesPerWallet) {
            throw gameForbidden(
                `You can have at most ${config.maximumOpenGamesPerWallet} open games`,
                "OPEN_GAME_LIMIT",
            );
        }

        const inserted = await client.query<DbGameRow>(
            `insert into dm_games (
                id,
                contract_game_id,
                game_type,
                mode,
                status,
                settlement_status,
                creator_address,
                opponent_address,
                stake_per_player_usdc,
                fee_bps,
                treasury_address,
                chain_id,
                contract_address,
                fen,
                position_history,
                invite_expires_at,
                created_at,
                updated_at
             ) values (
                $1, $2, $15, $3, 'INVITED', $4, $5, $6, $7, 1000,
                $8, $9, $10, $11, $12::jsonb, $13, $14, $14
             )
             returning *`,
            [
                id,
                contractGameId,
                config.mode,
                "UNFUNDED",
                creator,
                opponent,
                input.stakePerPlayerUsdc.toString(),
                config.treasuryAddress,
                config.chainId,
                config.contractAddress,
                initialFen,
                JSON.stringify(history),
                inviteExpiresAt,
                now,
                gameType, // $15
            ],
        );

        await insertGameEvent(client, {
            gameId: id,
            eventKey: `${id}:CREATED`,
            eventType: "GAME_CREATED",
            actor: creator,
            payload: {
                opponentAddress: opponent,
                stakePerPlayerUsdc: economics.stakePerPlayerMicros.toString(),
                totalPotUsdc: economics.totalPotMicros.toString(),
                gameType,
            },
        });

        if (opponent) {
            const gameLabel = gameType === "CHECKERS" ? "Checkers" : "Chess";
            await insertGameDm(client, {
                gameId: id,
                eventKey: `${id}:INVITE:${opponent}`,
                sender: creator,
                receiver: opponent,
                messageType: "GAME_INVITE",
                title: `${gameLabel} challenge`,
                description: `You were invited to a 24-hour ${gameLabel} game. Stake: ${economics.stakePerPlayerMicros.toString()} micro-USDC each.`,
                amountUsdc: economics.stakePerPlayerMicros,
            });
        }
        return mapDmGameRow(inserted.rows[0]);
    });
}

export async function getDmGame(id: string) {
    return withPgClient(async (client) => {
        const result = await client.query(
            "select * from dm_games where id = $1 limit 1",
            [id],
        );
        if (!result.rows[0]) throw gameNotFound();
        return mapDmGameRow(result.rows[0] as DbGameRow);
    });
}

export async function acceptDmGame(input: {
    gameId: string;
    playerAddress: string;
    config: ReturnTypeOfGetDmGamesConfig;
    now?: Date;
    opponentStakeTxHash?: string | null;
    /* On-chain color/deadline assignment from the verified GameJoined event. When provided we use
       them (so the DB and the escrow contract agree on who is White and when the game expires)
       instead of assigning locally; both must be provided together. */
    whiteAddress?: string | null;
    blackAddress?: string | null;
    expiresAtOverride?: Date | null;
}) {
    const player = input.playerAddress.toLowerCase();
    const now = input.now || new Date();

    return serializable(async (client) => {
        const role = await client.query<{ role: string }>(
            "select role from account_roles where address = $1 limit 1",
            [player],
        );
        if (role.rows[0]?.role !== "USER") {
            throw gameForbidden("Only USER accounts can accept games", "USER_ROLE_REQUIRED");
        }

        const selected = await client.query<DbGameRow>(
            "select * from dm_games where id = $1 for update",
            [input.gameId],
        );
        const row = selected.rows[0];
        if (!row) throw gameNotFound();
        const existing = mapDmGameRow(row);

        if (existing.status === "ACTIVE" && existing.opponentAddress === player) {
            return existing;
        }
        if (existing.status !== "INVITED") {
            throw gameConflict("This invitation is no longer claimable", "GAME_ALREADY_CLAIMED");
        }
        if (existing.inviteExpiresAt.getTime() <= now.getTime()) {
            await client.query(
                `update dm_games
                 set status = 'CANCELLED', result_reason = 'INVITE_EXPIRED', completed_at = $2, updated_at = $2
                 where id = $1 and status = 'INVITED'`,
                [existing.id, now],
            );
            throw gameConflict("This game invitation has expired", "GAME_INVITE_EXPIRED");
        }
        if (existing.creatorAddress === player) {
            throw gameForbidden("You cannot accept your own game", "SELF_PLAY_FORBIDDEN");
        }
        if (existing.opponentAddress && existing.opponentAddress !== player) {
            throw gameForbidden("This game is reserved for another player", "INVITE_RECEIVER_MISMATCH");
        }

        let whiteAddress: string;
        let blackAddress: string;
        if (input.whiteAddress && input.blackAddress) {
            whiteAddress = input.whiteAddress.toLowerCase();
            blackAddress = input.blackAddress.toLowerCase();
            const pair = new Set([whiteAddress, blackAddress]);
            if (pair.size !== 2 || !pair.has(existing.creatorAddress) || !pair.has(player)) {
                throw gameConflict("On-chain player colors do not match this game", "COLOR_MISMATCH");
            }
        } else {
            const creatorIsWhite = crypto.randomInt(0, 2) === 0;
            whiteAddress = creatorIsWhite ? existing.creatorAddress : player;
            blackAddress = creatorIsWhite ? player : existing.creatorAddress;
        }
        const expiresAt = input.expiresAtOverride || new Date(now.getTime() + input.config.activeGameTtlMs);

        const updated = await client.query<DbGameRow>(
            `update dm_games
             set opponent_address = $2,
                 white_address = $3,
                 black_address = $4,
                 current_turn_address = $3,
                 status = 'ACTIVE',
                 settlement_status = $5,
                 started_at = $6,
                 expires_at = $7,
                 opponent_stake_tx_hash = $8,
                 version = version + 1,
                 updated_at = $6
             where id = $1
               and status = 'INVITED'
               and (opponent_address is null or opponent_address = $2)
             returning *`,
            [
                existing.id,
                player,
                whiteAddress,
                blackAddress,
                "FUNDED",
                now,
                expiresAt,
                input.opponentStakeTxHash || null,
            ],
        );
        if (!updated.rows[0]) {
            throw gameConflict("Another player already claimed this invitation", "GAME_ALREADY_CLAIMED");
        }

        await insertGameEvent(client, {
            gameId: existing.id,
            eventKey: `${existing.id}:ACCEPTED`,
            eventType: "GAME_ACCEPTED",
            actor: player,
            payload: { whiteAddress, blackAddress, expiresAt: expiresAt.toISOString() },
        });
        const startedLabel = existing.gameType === "CHECKERS" ? "Checkers" : "Chess";
        await insertGameDm(client, {
            gameId: existing.id,
            eventKey: `${existing.id}:STARTED:${player}`,
            sender: existing.creatorAddress,
            receiver: player,
            messageType: "GAME_STARTED",
            title: `${startedLabel} game started`,
            description: `The fixed 24-hour timer has started. ${whiteAddress === existing.creatorAddress ? "Host" : "Guest"} moves first.`,
            amountUsdc: existing.stakePerPlayerUsdc,
        });

        return mapDmGameRow(updated.rows[0]);
    });
}

type TerminalReason =
    | "CHECKMATE"
    | "RESIGNATION"
    | "TIMEOUT"
    | "STALEMATE"
    | "INSUFFICIENT_MATERIAL"
    | "FIFTY_MOVE"
    | "THREEFOLD_REPETITION"
    | "ELIMINATION"
    | "DRAW";

async function finalizeGame(
    client: PoolClient,
    game: DmGameRecord,
    input: {
        winnerAddress: string | null;
        reason: TerminalReason;
        now: Date;
        expectedVersion?: number;
    },
) {
    if (!game.whiteAddress || !game.blackAddress || !game.opponentAddress) {
        throw gameConflict("Game participants are incomplete", "GAME_NOT_ACTIVE");
    }
    const isDraw = input.winnerAddress === null;
    const nextStatus = isDraw
        ? "DRAW"
        : input.winnerAddress === game.whiteAddress
            ? "WHITE_WON"
            : "BLACK_WON";
    const nextSettlementStatus = "AWAITING_SETTLEMENT";
    const params: unknown[] = [
        game.id,
        nextStatus,
        input.winnerAddress,
        input.reason,
        input.now,
        game.version,
        nextSettlementStatus,
    ];
    const updated = await client.query<DbGameRow>(
        `update dm_games
         set status = $2,
             settlement_status = $7,
             winner_address = $3,
             result_reason = $4,
             completed_at = $5,
             version = version + 1,
             updated_at = $5
         where id = $1 and status = 'ACTIVE' and version = $6
         returning *`,
        params,
    );
    if (!updated.rows[0]) {
        const replay = await client.query<DbGameRow>(
            "select * from dm_games where id = $1 limit 1",
            [game.id],
        );
        if (replay.rows[0] && replay.rows[0].status !== "ACTIVE") return mapDmGameRow(replay.rows[0]);
        throw gameConflict("Game state changed before settlement", "GAME_VERSION_CONFLICT");
    }
    const result = mapDmGameRow(updated.rows[0]);
    const economics = calculateGameEconomics(game.stakePerPlayerUsdc);
    const gameLabel = game.gameType === "CHECKERS" ? "Checkers" : "Chess";
    const title = isDraw ? `${gameLabel} game drawn` : `${gameLabel} game settled`;
    const description = isDraw
        ? `Draw by ${input.reason.toLowerCase().replaceAll("_", " ")}. Each ${game.stakePerPlayerUsdc} micro-USDC stake is refunded on-chain at settlement.`
        : `${input.winnerAddress} won by ${input.reason.toLowerCase()}. Payout: ${economics.winnerPayoutMicros} micro-USDC (treasury fee: ${economics.treasuryFeeMicros} micro-USDC). Claim on-chain to settle.`;

    await insertGameEvent(client, {
        gameId: game.id,
        eventKey: `${game.id}:RESULT`,
        eventType: "GAME_RESULT",
        actor: input.winnerAddress,
        payload: {
            status: nextStatus,
            reason: input.reason,
            winnerAddress: input.winnerAddress,
            winnerPayoutMicros: isDraw ? "0" : economics.winnerPayoutMicros.toString(),
            treasuryFeeMicros: isDraw ? "0" : economics.treasuryFeeMicros.toString(),
        },
    });
    await insertGameDm(client, {
        gameId: game.id,
        eventKey: `${game.id}:RESULT:${game.opponentAddress}`,
        sender: game.creatorAddress,
        receiver: game.opponentAddress,
        messageType: "GAME_RESULT",
        title,
        description,
        amountUsdc: isDraw ? game.stakePerPlayerUsdc : economics.winnerPayoutMicros,
    });
    return result;
}

export async function submitDmGameMove(input: {
    gameId: string;
    playerAddress: string;
    from: string;
    to: string;
    promotion?: string | null;
    expectedVersion: number;
    idempotencyKey: string;
    now?: Date;
}) {
    const player = input.playerAddress.toLowerCase();
    const now = input.now || new Date();
    if (!/^[a-h][1-8]$/.test(input.from) || !/^[a-h][1-8]$/.test(input.to)) {
        throw gameBadRequest("Move squares must use algebraic coordinates", "INVALID_MOVE");
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
        throw gameBadRequest("Idempotency-Key must be 8-128 safe characters", "INVALID_IDEMPOTENCY_KEY");
    }

    return serializable(async (client) => {
        const selected = await client.query<DbGameRow>(
            "select * from dm_games where id = $1 for update",
            [input.gameId],
        );
        if (!selected.rows[0]) throw gameNotFound();
        const game = mapDmGameRow(selected.rows[0]);

        const replay = await client.query<{ fen_after: string }>(
            `select fen_after from dm_game_moves
             where game_id = $1 and idempotency_key = $2 limit 1`,
            [game.id, input.idempotencyKey],
        );
        if (replay.rows[0]) return getGameInsideTransaction(client, game.id);

        if (game.status !== "ACTIVE" || !game.expiresAt) {
            throw gameConflict("This game is not active", "GAME_NOT_ACTIVE");
        }
        if (game.expiresAt.getTime() <= now.getTime()) {
            const winner = game.currentTurnAddress === game.whiteAddress ? game.blackAddress : game.whiteAddress;
            return finalizeGame(client, game, {
                winnerAddress: winner,
                reason: "TIMEOUT",
                now,
            });
        }
        if (game.version !== input.expectedVersion) {
            throw gameConflict("Game state is stale; refresh before moving", "GAME_VERSION_CONFLICT");
        }
        if (game.currentTurnAddress !== player) {
            throw gameForbidden("It is not your turn", "OUT_OF_TURN");
        }

        if (game.gameType === "CHECKERS") {
            const { applyCheckersMove } = await import("./checkers");
            const checkersRes = applyCheckersMove({
                fen: game.fen,
                from: input.from,
                to: input.to,
                positionHistory: game.positionHistory,
            });
            const nextTurnAddress = checkersRes.turn === "w" ? game.whiteAddress : game.blackAddress;
            const nextHistory = [...game.positionHistory, positionKey(checkersRes.fen)];
            const nextPly = game.ply + 1;
            const stateHash = ethers.keccak256(ethers.toUtf8Bytes(checkersRes.fen));

            await client.query(
                `insert into dm_game_moves (
                    game_id, ply, player_address, uci, san, fen_before, fen_after,
                    state_hash, idempotency_key
                 ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    game.id,
                    nextPly,
                    player,
                    checkersRes.uci,
                    checkersRes.san,
                    game.fen,
                    checkersRes.fen,
                    stateHash,
                    input.idempotencyKey,
                ],
            );

            const updated = await client.query<DbGameRow>(
                `update dm_games
                 set fen = $2,
                     position_history = $3::jsonb,
                     current_turn_address = $4,
                     ply = $5,
                     version = version + 1,
                     updated_at = $6
                 where id = $1
                   and status = 'ACTIVE'
                   and version = $7
                   and current_turn_address = $8
                   and expires_at > $6
                 returning *`,
                [
                    game.id,
                    checkersRes.fen,
                    JSON.stringify(nextHistory),
                    nextTurnAddress,
                    nextPly,
                    now,
                    game.version,
                    player,
                ],
            );
            if (!updated.rows[0]) {
                throw gameConflict("Move lost a state race; refresh and retry", "GAME_VERSION_CONFLICT");
            }
            const afterMove = mapDmGameRow(updated.rows[0]);
            await insertGameEvent(client, {
                gameId: game.id,
                eventKey: `${game.id}:PLY:${nextPly}`,
                eventType: "CHECKERS_MOVE",
                actor: player,
                payload: { uci: checkersRes.uci, san: checkersRes.san, stateHash },
            });

            if (checkersRes.status === "WHITE_WON" || checkersRes.status === "BLACK_WON") {
                const winnerAddress = checkersRes.winner === "w" ? game.whiteAddress : game.blackAddress;
                return finalizeGame(client, afterMove, {
                    winnerAddress,
                    reason: (checkersRes.reason || "ELIMINATION") as TerminalReason,
                    now,
                });
            }
            if (checkersRes.status === "DRAW") {
                return finalizeGame(client, afterMove, {
                    winnerAddress: null,
                    reason: "DRAW",
                    now,
                });
            }
            return afterMove;
        } else {
            const moveResult: ApplyChessMoveResult = applyChessMove({
                fen: game.fen,
                from: input.from,
                to: input.to,
                promotion: (input.promotion || undefined) as PromotionPiece | undefined,
                positionHistory: game.positionHistory,
            });
            const nextTurnAddress = moveResult.turn === "w" ? game.whiteAddress : game.blackAddress;
            const nextHistory = [...game.positionHistory, positionKey(moveResult.fen)];
            const nextPly = game.ply + 1;
            const stateHash = ethers.keccak256(ethers.toUtf8Bytes(moveResult.fen));

            await client.query(
                `insert into dm_game_moves (
                    game_id, ply, player_address, uci, san, fen_before, fen_after,
                    state_hash, idempotency_key
                 ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    game.id,
                    nextPly,
                    player,
                    moveResult.uci,
                    moveResult.san,
                    game.fen,
                    moveResult.fen,
                    stateHash,
                    input.idempotencyKey,
                ],
            );

            const updated = await client.query<DbGameRow>(
                `update dm_games
                 set fen = $2,
                     position_history = $3::jsonb,
                     current_turn_address = $4,
                     ply = $5,
                     version = version + 1,
                     updated_at = $6
                 where id = $1
                   and status = 'ACTIVE'
                   and version = $7
                   and current_turn_address = $8
                   and expires_at > $6
                 returning *`,
                [
                    game.id,
                    moveResult.fen,
                    JSON.stringify(nextHistory),
                    nextTurnAddress,
                    nextPly,
                    now,
                    game.version,
                    player,
                ],
            );
            if (!updated.rows[0]) {
                throw gameConflict("Move lost a state race; refresh and retry", "GAME_VERSION_CONFLICT");
            }
            const afterMove = mapDmGameRow(updated.rows[0]);
            await insertGameEvent(client, {
                gameId: game.id,
                eventKey: `${game.id}:PLY:${nextPly}`,
                eventType: "CHESS_MOVE",
                actor: player,
                payload: { uci: moveResult.uci, san: moveResult.san, stateHash },
            });

            if (moveResult.outcome.status === "CHECKMATE") {
                return finalizeGame(client, afterMove, {
                    winnerAddress: player,
                    reason: "CHECKMATE",
                    now,
                });
            }
            if (moveResult.outcome.status === "DRAW") {
                const drawReasons: Record<string, TerminalReason> = {
                    stalemate: "STALEMATE",
                    insufficient_material: "INSUFFICIENT_MATERIAL",
                    fifty_move: "FIFTY_MOVE",
                    threefold_repetition: "THREEFOLD_REPETITION",
                };
                const mappedReason = drawReasons[moveResult.outcome.reason] || "STALEMATE";
                return finalizeGame(client, afterMove, {
                    winnerAddress: null,
                    reason: mappedReason,
                    now,
                });
            }
            return afterMove;
        }
    });
}

async function getGameInsideTransaction(client: PoolClient, gameId: string) {
    const result = await client.query<DbGameRow>(
        "select * from dm_games where id = $1 limit 1",
        [gameId],
    );
    if (!result.rows[0]) throw gameNotFound();
    return mapDmGameRow(result.rows[0]);
}

export async function resignDmGame(input: {
    gameId: string;
    playerAddress: string;
    now?: Date;
}) {
    const player = input.playerAddress.toLowerCase();
    const now = input.now || new Date();
    return serializable(async (client) => {
        const result = await client.query<DbGameRow>(
            "select * from dm_games where id = $1 for update",
            [input.gameId],
        );
        if (!result.rows[0]) throw gameNotFound();
        const game = mapDmGameRow(result.rows[0]);
        if (game.status !== "ACTIVE" || !game.whiteAddress || !game.blackAddress) {
            if (game.status !== "ACTIVE") return game;
            throw gameConflict("This game is not active", "GAME_NOT_ACTIVE");
        }
        if (player !== game.whiteAddress && player !== game.blackAddress) {
            throw gameForbidden("Only a participant can resign", "NOT_A_GAME_PARTICIPANT");
        }
        const winner = player === game.whiteAddress ? game.blackAddress : game.whiteAddress;
        return finalizeGame(client, game, {
            winnerAddress: winner,
            reason: "RESIGNATION",
            now,
        });
    });
}

export async function timeoutDmGame(input: {
    gameId: string;
    requestedBy?: string | null;
    now?: Date;
}) {
    const now = input.now || new Date();
    return serializable(async (client) => {
        const result = await client.query<DbGameRow>(
            "select * from dm_games where id = $1 for update",
            [input.gameId],
        );
        if (!result.rows[0]) throw gameNotFound();
        const game = mapDmGameRow(result.rows[0]);
        if (game.status !== "ACTIVE") return game;
        if (
            input.requestedBy
            && ![game.creatorAddress, game.opponentAddress].includes(input.requestedBy.toLowerCase())
        ) {
            throw gameForbidden("Only a participant can request timeout settlement", "NOT_A_GAME_PARTICIPANT");
        }
        if (!game.expiresAt || game.expiresAt.getTime() > now.getTime()) {
            throw gameConflict("The 24-hour game deadline has not arrived", "GAME_NOT_EXPIRED");
        }
        const winner = game.currentTurnAddress === game.whiteAddress ? game.blackAddress : game.whiteAddress;
        return finalizeGame(client, game, {
            winnerAddress: winner,
            reason: "TIMEOUT",
            now,
        });
    });
}

export async function settleExpiredDmGames(now = new Date(), limit = 25) {
    const ids = await withPgClient(async (client) => {
        const result = await client.query(
            `select id from dm_games
             where status = 'ACTIVE' and expires_at <= $1
             order by expires_at asc
             limit $2`,
            [now, limit],
        );
        return result.rows.map((row: any) => row.id);
    });
    const results = [];
    for (const id of ids) {
        try {
            results.push(await timeoutDmGame({ gameId: id, now }));
        } catch (error) {
            console.error(`Failed to settle expired DM game ${id}:`, error);
        }
    }
    return results;
}

/** Contract-backed games that have a decided result but no on-chain settlement yet. Used by the
    keeper to relay settleGame so the winner is never exposed to a permissionless claimTimeout. */
export async function listGamesAwaitingOnchainSettlement(limit = 50): Promise<DmGameRecord[]> {
    return withPgClient(async (client) => {
        const result = await client.query(
            `select * from dm_games
             where settlement_status = 'AWAITING_SETTLEMENT'
               and contract_address is not null
               and status in ('WHITE_WON', 'BLACK_WON', 'DRAW')
             order by completed_at asc nulls last
             limit $1`,
            [limit],
        );
        return (result.rows as DbGameRow[]).map(mapDmGameRow);
    });
}

/** Invitations that expired before an opponent joined. Cancels them in the DB (idempotently) and
    returns the ones that were funded on-chain (creatorStakeTxHash present) so the caller can
    reclaim the creator's escrow. */
export async function expireStaleInvites(now = new Date(), limit = 50): Promise<DmGameRecord[]> {
    return withPgClient(async (client) => {
        const result = await client.query(
            `update dm_games
             set status = 'CANCELLED', result_reason = 'INVITE_EXPIRED', completed_at = $1, updated_at = $1
             where id in (
                 select id from dm_games
                 where status = 'INVITED' and invite_expires_at <= $1
                 order by invite_expires_at asc
                 limit $2
                 for update skip locked
             )
             returning *`,
            [now, limit],
        );
        return (result.rows as DbGameRow[]).map(mapDmGameRow);
    });
}

/** Record that an expired, funded invitation's escrow was reclaimed on-chain. */
export async function markInviteRefunded(input: { gameId: string; txHash: string }) {
    return withPgClient(async (client) => {
        await client.query(
            `update dm_games
             set settlement_status = 'SETTLED', settlement_tx_hash = $2, updated_at = now()
             where id = $1`,
            [input.gameId, input.txHash],
        );
    });
}

export async function updateCreatorStake(input: {
    gameId: string;
    contractGameId: string;
    txHash: string;
}) {
    return withPgClient(async (client) => {
        const result = await client.query(
            `update dm_games
             set contract_game_id = $2,
                 creator_stake_tx_hash = $3,
                 settlement_status = 'CREATOR_FUNDED',
                 updated_at = now()
             where id = $1
             returning *`,
            [input.gameId, input.contractGameId, input.txHash],
        );
        if (!result.rows[0]) throw gameNotFound();
        return mapDmGameRow(result.rows[0] as DbGameRow);
    });
}

export async function updateGameSettlement(input: {
    gameId: string;
    txHash: string;
}) {
    return withPgClient(async (client) => {
        const result = await client.query(
            `update dm_games
             set settlement_tx_hash = $2,
                 settlement_status = 'SETTLED',
                 updated_at = now()
             where id = $1
             returning *`,
            [input.gameId, input.txHash],
        );
        if (!result.rows[0]) throw gameNotFound();
        return mapDmGameRow(result.rows[0] as DbGameRow);
    });
}
