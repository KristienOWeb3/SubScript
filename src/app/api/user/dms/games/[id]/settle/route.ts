import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame, updateGameSettlement } from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
import { walletHasEmbeddedKey, settleGameFromEmbedded } from "@/lib/games/onchain";
import { signGameResult } from "@/lib/games/signing";
import { enforceDmGameRateLimit } from "@/lib/games/rate-limit";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { ethers } from "ethers";
import { sanitizeInput } from "@/utils/security";

type Props = {
    params: Promise<{ id: string }>;
};

const GAME_SETTLED_TOPIC = ethers.id("GameSettled(uint256,address,uint256,uint256,uint8,bytes32)").toLowerCase();
const GAME_DRAWN_TOPIC = ethers.id("GameDrawn(uint256,uint256,bytes32)").toLowerCase();

export async function POST(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        await enforceDmGameRateLimit(wallet!, "terminal");

        const body = await request.json().catch(() => ({}));
        const sanitized = sanitizeInput(body || {});
        let txHash: string | null = typeof sanitized.txHash === "string" ? sanitized.txHash : null;

        const game = await getDmGame(id);

        /* Only a participant may drive settlement — otherwise anyone could burn sponsor gas
           relaying settleGame for arbitrary finished games (consistent with the GET/resign routes). */
        const caller = wallet!.toLowerCase();
        if (caller !== game.creatorAddress.toLowerCase() && caller !== game.opponentAddress?.toLowerCase()) {
            return NextResponse.json({ error: "Access denied to game" }, { status: 403 });
        }

        const config = getDmGamesConfig();
        if (!config.enabled || config.mode !== "testnet" || !config.contractAddress) {
            return NextResponse.json({ error: "Contract-backed games are not active" }, { status: 503 });
        }

        if (game.settlementStatus === "SETTLED") {
            return NextResponse.json({
                success: true,
                game: { ...game, stakePerPlayerUsdc: game.stakePerPlayerUsdc.toString() },
            }, { status: 200 });
        }

        /* Embedded (email) wallet: SubScript signs the referee result and submits settleGame from
           the caller's server-held key (gas sponsored), then verifies its own tx below. Only a
           finished game can be settled. */
        if (!txHash) {
            if (!(await walletHasEmbeddedKey(wallet!))) {
                return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
            }
            const draw = game.status === "DRAW";
            const winnerAddress = game.status === "WHITE_WON"
                ? game.whiteAddress
                : game.status === "BLACK_WON"
                    ? game.blackAddress
                    : null;
            if (!draw && !winnerAddress) {
                return NextResponse.json({ error: "Game is not finished yet" }, { status: 409 });
            }
            const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
            const sig = await signGameResult({
                gameId: game.contractGameId,
                winnerAddress,
                draw,
                finalFen: game.fen,
                validUntil,
            });
            await requireGasSponsored(wallet!);
            txHash = await settleGameFromEmbedded({
                walletAddress: wallet!,
                escrowAddress: config.contractAddress,
                contractGameId: game.contractGameId,
                winnerAddress,
                draw,
                finalStateHash: sig.finalStateHash,
                validUntil: sig.validUntil,
                signature: sig.signature,
            });
        }

        if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
            return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
        }

        // Verify transaction on-chain
        const rpcUrl = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const receipt = await provider.waitForTransaction(txHash, 1, 30_000);

        if (!receipt || receipt.status !== 1) {
            return NextResponse.json({ error: "Transaction failed or was not found on-chain" }, { status: 400 });
        }

        const escrowAddress = config.contractAddress.toLowerCase();
        let verified = false;

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== escrowAddress) continue;

            const topic = (log.topics[0] || "").toLowerCase();
            if (topic === GAME_SETTLED_TOPIC || topic === GAME_DRAWN_TOPIC) {
                const onChainGameId = BigInt(log.topics[1]).toString();
                if (onChainGameId === game.contractGameId) {
                    verified = true;
                    break;
                }
            }
        }

        if (!verified) {
            return NextResponse.json({ error: "Could not verify settlement event in this transaction" }, { status: 400 });
        }

        const updatedGame = await updateGameSettlement({
            gameId: id,
            txHash,
        });

        const formatted = {
            ...updatedGame,
            stakePerPlayerUsdc: updatedGame.stakePerPlayerUsdc.toString(),
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "settle");
    }
}
