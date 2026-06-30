import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame, updateGameSettlement } from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
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

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitized = sanitizeInput(body);
        const { txHash } = sanitized;

        if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
            return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
        }

        const game = await getDmGame(id);
        const config = getDmGamesConfig();
        if (!config.enabled || config.mode !== "testnet" || !config.contractAddress) {
            return NextResponse.json({ error: "Contract-backed games are not active" }, { status: 503 });
        }

        if (game.settlementStatus === "SETTLED") {
            return NextResponse.json({ success: true, game }, { status: 200 });
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
