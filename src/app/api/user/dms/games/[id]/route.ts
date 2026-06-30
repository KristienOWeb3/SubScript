import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame } from "@/lib/games/service";
import { signGameResult } from "@/lib/games/signing";

type Props = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        const game = await getDmGame(id);

        // Security check: only participants can view details of their game
        const creator = game.creatorAddress.toLowerCase();
        const opponent = game.opponentAddress?.toLowerCase();
        const caller = wallet!.toLowerCase();
        if (caller !== creator && caller !== opponent) {
            return NextResponse.json({ error: "Access denied to game" }, { status: 403 });
        }

        // For finished testnet games, generate the referee signature on-the-fly
        let refereeSignature = null;
        const isFinished = ["WHITE_WON", "BLACK_WON", "DRAW"].includes(game.status);
        if (isFinished && game.mode === "testnet" && game.contractGameId) {
            try {
                const draw = game.status === "DRAW";
                const winnerAddress = game.status === "WHITE_WON"
                    ? game.whiteAddress
                    : game.status === "BLACK_WON"
                        ? game.blackAddress
                        : null;

                // Signatures valid for 24 hours from current fetch
                const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

                const sigData = await signGameResult({
                    gameId: game.contractGameId,
                    winnerAddress,
                    draw,
                    finalFen: game.fen,
                    validUntil,
                });

                refereeSignature = {
                    signature: sigData.signature,
                    finalStateHash: sigData.finalStateHash,
                    validUntil: sigData.validUntil,
                    refereeAddress: sigData.refereeAddress,
                };
            } catch (sigErr) {
                console.error(`Failed to generate referee signature for game ${id}:`, sigErr);
            }
        }

        // Format BigInt values for JSON response
        const formattedGame = {
            ...game,
            stakePerPlayerUsdc: game.stakePerPlayerUsdc.toString(),
            refereeSignature,
        };

        return NextResponse.json({ success: true, game: formattedGame }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "retrieve");
    }
}
