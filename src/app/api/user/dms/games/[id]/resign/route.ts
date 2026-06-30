import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGamesConfig } from "@/lib/games/config";
import { resignDmGame } from "@/lib/games/service";
import { signGameResult } from "@/lib/games/signing";

type Props = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        const config = getDmGamesConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: "Games are disabled" }, { status: 503 });
        }

        const updatedGame = await resignDmGame({
            gameId: id,
            playerAddress: wallet!,
        });

        let refereeSignature = null;
        if (config.mode === "testnet" && updatedGame.contractGameId) {
            try {
                const winnerAddress = updatedGame.status === "WHITE_WON"
                    ? updatedGame.whiteAddress
                    : updatedGame.status === "BLACK_WON"
                        ? updatedGame.blackAddress
                        : null;

                const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

                const sigData = await signGameResult({
                    gameId: updatedGame.contractGameId,
                    winnerAddress,
                    draw: false,
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
                console.error("Failed to generate referee signature on resignation:", sigErr);
            }
        }

        const formatted = {
            ...updatedGame,
            stakePerPlayerUsdc: updatedGame.stakePerPlayerUsdc.toString(),
            refereeSignature,
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "resign");
    }
}
