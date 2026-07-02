/* Server-side signing of DM-game escrow actions from a user's embedded wallet.
 *
 * Email/embedded-wallet users have no browser wallet connector, so they can't call the escrow
 * with wagmi's writeContractAsync (that throws "connector not connected"). Instead SubScript signs
 * the approve + escrow call from the user's server-held key — exactly like vault commits — and the
 * caller sponsors gas first. The state hash uses keccak256(utf8(fen)), identical to the referee
 * signer (signGameResult), so on-chain settlement verifies. */
import { ethers } from "ethers";
import { pgMaybeOne } from "@/lib/serverPg";
import { getEmbeddedSigner } from "@/lib/vault/onchain";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { getDmGamesConfig } from "./config";
import { signGameResult } from "./signing";

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

const ESCROW_ABI = [
    "function createGame(address opponent, uint256 stake, bytes32 initialStateHash) returns (uint256)",
    "function joinGame(uint256 gameId)",
    "function settleGame(uint256 gameId, address winner, bool draw, bytes32 finalStateHash, uint256 validUntil, bytes signature)",
    "function claimTimeout(uint256 gameId)",
    "function cancelUnjoinedGame(uint256 gameId)",
];

function keeperSigner(): ethers.Wallet {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) throw new Error("KEEPER_PRIVATE_KEY is not configured on the backend");
    const rpcUrl = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
    return new ethers.Wallet(key, new ethers.JsonRpcProvider(rpcUrl));
}

/** True when this wallet has a server-held (embedded) key — i.e. no browser wallet to sign with. */
export async function walletHasEmbeddedKey(walletAddress: string): Promise<boolean> {
    const record = await pgMaybeOne<{ wallet_address: string }>(
        "select wallet_address from user_embedded_wallets where wallet_address = $1 limit 1",
        [walletAddress.toLowerCase()],
    );
    return Boolean(record);
}

async function ensureAllowance(signer: ethers.Wallet, escrowAddress: string, amount: bigint) {
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);
    const allowance: bigint = await usdc.allowance(signer.address, escrowAddress);
    if (allowance < amount) {
        const tx = await usdc.approve(escrowAddress, amount);
        await tx.wait();
    }
}

/** Creator stakes: approve (if needed) then createGame(opponent, stake, hash). Returns tx hash. */
export async function createGameFromEmbedded(input: {
    walletAddress: string;
    escrowAddress: string;
    opponentAddress: string | null;
    stakeMicros: bigint;
    initialFen: string;
}): Promise<string> {
    const signer = await getEmbeddedSigner(input.walletAddress);
    await ensureAllowance(signer, input.escrowAddress, input.stakeMicros);
    const escrow = new ethers.Contract(input.escrowAddress, ESCROW_ABI, signer);
    const initialStateHash = ethers.id(input.initialFen);
    const tx = await escrow.createGame(
        input.opponentAddress || ethers.ZeroAddress,
        input.stakeMicros,
        initialStateHash,
    );
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Opponent joins: approve (if needed) then joinGame(gameId). Returns tx hash. */
export async function joinGameFromEmbedded(input: {
    walletAddress: string;
    escrowAddress: string;
    contractGameId: string;
    stakeMicros: bigint;
}): Promise<string> {
    const signer = await getEmbeddedSigner(input.walletAddress);
    await ensureAllowance(signer, input.escrowAddress, input.stakeMicros);
    const escrow = new ethers.Contract(input.escrowAddress, ESCROW_ABI, signer);
    const tx = await escrow.joinGame(BigInt(input.contractGameId));
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Winner (or either player on a draw) submits the referee-signed result. Returns tx hash. */
export async function settleGameFromEmbedded(input: {
    walletAddress: string;
    escrowAddress: string;
    contractGameId: string;
    winnerAddress: string | null;
    draw: boolean;
    finalStateHash: string;
    validUntil: number;
    signature: string;
}): Promise<string> {
    const signer = await getEmbeddedSigner(input.walletAddress);
    const escrow = new ethers.Contract(input.escrowAddress, ESCROW_ABI, signer);
    const tx = await escrow.settleGame(
        BigInt(input.contractGameId),
        input.winnerAddress || ethers.ZeroAddress,
        input.draw,
        input.finalStateHash,
        BigInt(input.validUntil),
        input.signature,
    );
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Non-current-turn player claims the pot once the 24h deadline passes. Returns tx hash. */
export async function claimTimeoutFromEmbedded(input: {
    walletAddress: string;
    escrowAddress: string;
    contractGameId: string;
}): Promise<string> {
    const signer = await getEmbeddedSigner(input.walletAddress);
    const escrow = new ethers.Contract(input.escrowAddress, ESCROW_ABI, signer);
    const tx = await escrow.claimTimeout(BigInt(input.contractGameId));
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/**
 * Keeper (= on-chain referee) relays the signed result itself, rather than waiting for the
 * winner to submit settleGame. This closes the window where a decided-but-unsettled game can be
 * seized on-chain via the permissionless claimTimeout after the 24h deadline (the contract never
 * advances currentTurn, so claimTimeout always pays Black). Idempotent by construction: the
 * contract reverts settleGame once the game is no longer Active, so a concurrent user-submitted
 * settlement simply makes this a no-op. Returns the settlement tx hash, or null if unsettleable.
 */
export async function relaySettlementFromKeeper(input: {
    contractGameId: string;
    status: string;
    whiteAddress: string | null;
    blackAddress: string | null;
    fen: string;
}): Promise<string | null> {
    const config = getDmGamesConfig();
    if (!config.enabled || config.mode !== "testnet" || !config.contractAddress) return null;

    const draw = input.status === "DRAW";
    const winnerAddress = input.status === "WHITE_WON"
        ? input.whiteAddress
        : input.status === "BLACK_WON"
            ? input.blackAddress
            : null;
    if (!draw && !winnerAddress) return null;

    const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const sig = await signGameResult({
        gameId: input.contractGameId,
        winnerAddress,
        draw,
        finalFen: input.fen,
        validUntil,
    });

    const escrow = new ethers.Contract(config.contractAddress, ESCROW_ABI, keeperSigner());
    const tx = await escrow.settleGame(
        BigInt(input.contractGameId),
        winnerAddress || ethers.ZeroAddress,
        draw,
        sig.finalStateHash,
        BigInt(sig.validUntil),
        sig.signature,
    );
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Creator reclaims their stake from an invitation that expired before anyone joined. Signed
 *  from the creator's server-held (embedded) key. Returns tx hash. */
export async function cancelUnjoinedGameFromEmbedded(input: {
    walletAddress: string;
    escrowAddress: string;
    contractGameId: string;
}): Promise<string> {
    const signer = await getEmbeddedSigner(input.walletAddress);
    const escrow = new ethers.Contract(input.escrowAddress, ESCROW_ABI, signer);
    const tx = await escrow.cancelUnjoinedGame(BigInt(input.contractGameId));
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}
