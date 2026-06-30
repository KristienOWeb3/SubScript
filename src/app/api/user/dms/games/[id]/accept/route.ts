import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGame, acceptDmGame } from "@/lib/games/service";
import { getDmGamesConfig } from "@/lib/games/config";
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

        const body = await request.json().catch(() => null);
        const sanitized = sanitizeInput(body || {});
        const { txHash } = sanitized;

        const game = await getDmGame(id);
        const config = getDmGamesConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: "Games are disabled" }, { status: 503 });
        }

        let opponentStakeTxHash = null;

        if (config.mode === "testnet") {
            if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
                return NextResponse.json({ error: "Transaction hash is required for testnet games" }, { status: 400 });
            }

            if (!game.contractGameId) {
                return NextResponse.json({ error: "Creator has not funded their stake on-chain yet" }, { status: 400 });
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
        }

        // Accept the game (service handles random color allocation in sandbox,
        // but wait, does it handle random color allocation in testnet?
        // Wait, on-chain, joinGame determines the color assignment:
        // game.playerWhite = creatorIsWhite ? creator : msg.sender;
        // So we should align the DB colors with the on-chain colors if we are in testnet mode!
        // Wait! In service.ts, acceptDmGame randomizes colors. But we can override this
        // or just let it randomize. Wait, to be 100% correct, in testnet mode we want
        // whiteAddress and blackAddress to be exactly what was emitted by the event!)
        
        const acceptedGame = await acceptDmGame({
            gameId: id,
            playerAddress: wallet!,
            config,
            opponentStakeTxHash,
        });

        // If in testnet, sync the actual on-chain colors emitted in verifiedEvent!
        let finalGame = acceptedGame;
        if (config.mode === "testnet" && opponentStakeTxHash) {
            // Wait, we need to update the database to match the contract white/black assignment
            // We can run a direct update using prisma or withPgClient to fix it, or let the accept API handle it.
            // Let's run a quick query to sync colors to match the blockchain event exactly!
            const { withPgClient } = await import("@/lib/serverPg");
            const rpcUrl = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const receipt = await provider.getTransactionReceipt(opponentStakeTxHash);
            if (receipt) {
                const escrowAddress = config.contractAddress!.toLowerCase();
                for (const log of receipt.logs) {
                    if (log.address.toLowerCase() !== escrowAddress) continue;
                    if ((log.topics[0] || "").toLowerCase() !== GAME_JOINED_TOPIC) continue;

                    const playerWhite = ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase();
                    const playerBlack = ethers.getAddress("0x" + log.topics[3].slice(26)).toLowerCase();
                    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint64"], log.data);
                    const expiresAt = new Date(Number(decoded[0]) * 1000);

                    finalGame = await withPgClient(async (client) => {
                        const res = await client.query(
                            `update dm_games
                             set white_address = $2,
                                 black_address = $3,
                                 current_turn_address = $2,
                                 expires_at = $4,
                                 updated_at = now()
                             where id = $1
                             returning *`,
                            [id, playerWhite, playerBlack, expiresAt]
                        );
                        const { mapDmGameRow } = await import("@/lib/games/service");
                        return mapDmGameRow(res.rows[0]);
                    });
                    break;
                }
            }
        }

        const formatted = {
            ...finalGame,
            stakePerPlayerUsdc: finalGame.stakePerPlayerUsdc.toString(),
        };

        return NextResponse.json({ success: true, game: formatted }, { status: 200 });
    } catch (error) {
        return dmGameErrorResponse(error, "accept");
    }
}
