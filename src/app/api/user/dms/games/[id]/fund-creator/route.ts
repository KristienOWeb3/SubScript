import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame, updateCreatorStake } from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
import { walletHasEmbeddedKey, createGameFromEmbedded } from "@/lib/games/onchain";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { ethers } from "ethers";
import { sanitizeInput } from "@/utils/security";

type Props = {
    params: Promise<{ id: string }>;
};

const GAME_CREATED_TOPIC = ethers.id("GameCreated(uint256,address,address,uint256,bytes32)").toLowerCase();

export async function POST(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        const body = await request.json().catch(() => ({}));
        const sanitized = sanitizeInput(body || {});
        let txHash: string | null = typeof sanitized.txHash === "string" ? sanitized.txHash : null;

        const game = await getDmGame(id);
        if (game.creatorAddress.toLowerCase() !== wallet!.toLowerCase()) {
            return NextResponse.json({ error: "Only the creator can submit funding verification" }, { status: 403 });
        }
        if (game.creatorStakeTxHash) {
            return NextResponse.json({ error: "Creator stake has already been verified" }, { status: 409 });
        }

        const config = getDmGamesConfig();
        if (!config.enabled || config.mode !== "testnet" || !config.contractAddress) {
            return NextResponse.json({ error: "Contract-backed games are not active" }, { status: 503 });
        }

        /* Embedded (email) wallets have no browser connector to sign with — SubScript stakes to the
           escrow from their server-held key, gas sponsored, and verifies its own tx below. */
        if (!txHash) {
            if (!(await walletHasEmbeddedKey(wallet!))) {
                return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
            }
            await requireGasSponsored(wallet!);
            txHash = await createGameFromEmbedded({
                walletAddress: wallet!,
                escrowAddress: config.contractAddress,
                opponentAddress: game.opponentAddress,
                stakeMicros: game.stakePerPlayerUsdc,
                initialFen: game.fen,
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
            return NextResponse.json({ error: "Transaction was not confirmed on-chain" }, { status: 400 });
        }

        const escrowAddress = config.contractAddress.toLowerCase();
        let verifiedEvent = null;

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== escrowAddress) continue;
            if ((log.topics[0] || "").toLowerCase() !== GAME_CREATED_TOPIC) continue;

            const onChainGameId = BigInt(log.topics[1]).toString();
            const creator = ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase();

            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256", "bytes32"],
                log.data
            );
            const stake = decoded[0];

            verifiedEvent = { onChainGameId, creator, stake };
            break;
        }

        if (!verifiedEvent) {
            return NextResponse.json({ error: "Could not find a valid GameCreated event in this transaction" }, { status: 400 });
        }

        if (verifiedEvent.creator !== game.creatorAddress.toLowerCase()) {
            return NextResponse.json({ error: "Transaction sender does not match the game creator" }, { status: 400 });
        }

        if (BigInt(verifiedEvent.stake) !== game.stakePerPlayerUsdc) {
            return NextResponse.json({ error: "Staked amount does not match the game requirement" }, { status: 400 });
        }

        // Update database with creator stake verified
        const updatedGame = await updateCreatorStake({
            gameId: id,
            contractGameId: verifiedEvent.onChainGameId,
            txHash,
        });

        // Format BigInt values for JSON response
        const formatted = {
            ...updatedGame,
            stakePerPlayerUsdc: updatedGame.stakePerPlayerUsdc.toString(),
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "verify creator stake");
    }
}
