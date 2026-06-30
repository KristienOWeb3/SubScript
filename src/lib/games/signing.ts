import { ethers } from "ethers";
import { getDmGamesConfig } from "./config";

export async function signGameResult(input: {
    gameId: string | number; // Sequential on-chain game ID
    winnerAddress: string | null;
    draw: boolean;
    finalFen: string;
    validUntil: number; // Unix timestamp
}) {
    const config = getDmGamesConfig();
    if (!config.enabled) {
        throw new Error("Games are disabled");
    }
    if (!config.contractAddress) {
        throw new Error("Game escrow contract address not configured");
    }

    const privateKey = process.env.KEEPER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("KEEPER_PRIVATE_KEY is not configured on the backend");
    }

    const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const refereeWallet = new ethers.Wallet(privateKey, provider);

    const domain = {
        name: "SubScriptGameEscrow",
        version: "1",
        chainId: config.chainId,
        verifyingContract: config.contractAddress,
    };

    const types = {
        GameResult: [
            { name: "gameId", type: "uint256" },
            { name: "winner", type: "address" },
            { name: "draw", type: "bool" },
            { name: "finalStateHash", type: "bytes32" },
            { name: "validUntil", type: "uint256" },
        ],
    };

    // Calculate state hash from the final FEN string (same as off-chain state_hash)
    const finalStateHash = ethers.keccak256(ethers.toUtf8Bytes(input.finalFen));

    const value = {
        gameId: BigInt(input.gameId),
        winner: input.winnerAddress ? input.winnerAddress.toLowerCase() : ethers.ZeroAddress,
        draw: input.draw,
        finalStateHash,
        validUntil: BigInt(input.validUntil),
    };

    const signature = await refereeWallet.signTypedData(domain, types, value);

    return {
        signature,
        finalStateHash,
        validUntil: input.validUntil,
        refereeAddress: refereeWallet.address,
    };
}
