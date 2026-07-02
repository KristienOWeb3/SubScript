import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse, scheduleKeeperSettlement } from "@/lib/games/route";
import { getDmGamesConfig } from "@/lib/games/config";
import { submitDmGameMove } from "@/lib/games/service";
import { signGameResult } from "@/lib/games/signing";
import { enforceDmGameRateLimit } from "@/lib/games/rate-limit";
import { sanitizeInput } from "@/utils/security";

type Props = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        await enforceDmGameRateLimit(wallet!, "move");

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitized = sanitizeInput(body);
        const { from, to, promotion, expectedVersion, idempotencyKey } = sanitized;

        const config = getDmGamesConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: "Games are disabled" }, { status: 503 });
        }

        const updatedGame = await submitDmGameMove({
            gameId: id,
            playerAddress: wallet!,
            from,
            to,
            promotion: promotion || null,
            expectedVersion: Number(expectedVersion),
            idempotencyKey: idempotencyKey || `move:${id}:${expectedVersion}:${Date.now()}`,
        });

        // Check if the move finalized the game. If so, generate referee signature
        let refereeSignature = null;
        const isFinished = ["WHITE_WON", "BLACK_WON", "DRAW"].includes(updatedGame.status);
        if (isFinished && config.mode === "testnet" && updatedGame.contractGameId) {
            try {
                const draw = updatedGame.status === "DRAW";
                const winnerAddress = updatedGame.status === "WHITE_WON"
                    ? updatedGame.whiteAddress
                    : updatedGame.status === "BLACK_WON"
                        ? updatedGame.blackAddress
                        : null;

                const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours validity

                const sigData = await signGameResult({
                    gameId: updatedGame.contractGameId,
                    winnerAddress,
                    draw,
                    finalFen: updatedGame.fen,
                    validUntil,
                });

                refereeSignature = {
                    signature: sigData.signature,
                    finalStateHash: sigData.finalStateHash,
                    validUntil: sigData.validUntil,
                    refereeAddress: sigData.refereeAddress,
                };
            } catch (sigErr) {
                console.error("Failed to generate referee signature on move completion:", sigErr);
            }
        }

        if (isFinished) scheduleKeeperSettlement(updatedGame);

        const formatted = {
            ...updatedGame,
            stakePerPlayerUsdc: updatedGame.stakePerPlayerUsdc.toString(),
            refereeSignature,
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "submit move");
    }
}
