import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame, acceptDmGame } from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
import { walletHasEmbeddedKey, joinGameFromEmbedded } from "@/lib/games/onchain";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { ethers } from "ethers";
import { sanitizeInput } from "@/utils/security";

type Props = {
    params: Promise<{ id: string }>;
};

const GAME_JOINED_TOPIC = ethers.id("GameJoined(uint256,address,address,uint64)").toLowerCase();

export async function POST(request: Request, { params }: Props) {
    try {
        const { id } = await params;
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        const body = await request.json().catch(() => ({}));
        const sanitized = sanitizeInput(body || {});
        let txHash: string | null = typeof sanitized.txHash === "string" ? sanitized.txHash : null;

        const game = await getDmGame(id);
        const config = getDmGamesConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: "Games are disabled" }, { status: 503 });
        }

        let opponentStakeTxHash = null;
        let onChainAssignment: { white: string; black: string; expiresAt: Date } | null = null;

        if (config.mode === "testnet") {
            if (!game.contractGameId) {
                return NextResponse.json({ error: "Creator has not funded their stake on-chain yet" }, { status: 400 });
            }

            /* Embedded (email) wallets have no browser connector — SubScript joins on their behalf
               from their server-held key, gas sponsored, then verifies the resulting tx below. */
            if (!txHash) {
                if (!(await walletHasEmbeddedKey(wallet!))) {
                    return NextResponse.json({ error: "Transaction hash is required for testnet games" }, { status: 400 });
                }
                await requireGasSponsored(wallet!);
                txHash = await joinGameFromEmbedded({
                    walletAddress: wallet!,
                    escrowAddress: config.contractAddress!,
                    contractGameId: game.contractGameId,
                    stakeMicros: game.stakePerPlayerUsdc,
                });
            }

            if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
                return NextResponse.json({ error: "Transaction hash is required for testnet games" }, { status: 400 });
            }

            // Verify joinGame transaction on-chain
            const rpcUrl = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const receipt = await provider.waitForTransaction(txHash, 1, 30_000);

            if (!receipt || receipt.status !== 1) {
                return NextResponse.json({ error: "Transaction was not confirmed on-chain" }, { status: 400 });
            }

            const escrowAddress = config.contractAddress!.toLowerCase();
            let verifiedEvent = null;

            for (const log of receipt.logs) {
                if (log.address.toLowerCase() !== escrowAddress) continue;
                if ((log.topics[0] || "").toLowerCase() !== GAME_JOINED_TOPIC) continue;

                const onChainGameId = BigInt(log.topics[1]).toString();
                const playerWhite = ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase();
                const playerBlack = ethers.getAddress("0x" + log.topics[3].slice(26)).toLowerCase();

                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                    ["uint64"],
                    log.data
                );
                const deadline = Number(decoded[0]) * 1000; // Convert to millisecond timestamp

                verifiedEvent = { onChainGameId, playerWhite, playerBlack, deadline };
                break;
            }

            if (!verifiedEvent) {
                return NextResponse.json({ error: "Could not find a valid GameJoined event in this transaction" }, { status: 400 });
            }

            if (verifiedEvent.onChainGameId !== game.contractGameId) {
                return NextResponse.json({ error: "Transaction is for a different game ID" }, { status: 400 });
            }

            const callerLower = wallet!.toLowerCase();
            if (verifiedEvent.playerWhite !== callerLower && verifiedEvent.playerBlack !== callerLower) {
                return NextResponse.json({ error: "You are not registered as a player in this on-chain game" }, { status: 400 });
            }

            opponentStakeTxHash = txHash;
            onChainAssignment = {
                white: verifiedEvent.playerWhite,
                black: verifiedEvent.playerBlack,
                expiresAt: new Date(verifiedEvent.deadline),
            };
        }

        /* Accept atomically. For testnet we pass the colors + deadline the escrow contract emitted
           in GameJoined, so the DB agrees with the contract (who is White, when it expires) and the
           "game started" DM names the right first mover. Without an on-chain assignment (should not
           happen in testnet) the service falls back to a local random color allocation. */
        const acceptedGame = await acceptDmGame({
            gameId: id,
            playerAddress: wallet!,
            config,
            opponentStakeTxHash,
            whiteAddress: onChainAssignment?.white ?? null,
            blackAddress: onChainAssignment?.black ?? null,
            expiresAtOverride: onChainAssignment?.expiresAt ?? null,
        });

        const formatted = {
            ...acceptedGame,
            stakePerPlayerUsdc: acceptedGame.stakePerPlayerUsdc.toString(),
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "accept");
    }
}
