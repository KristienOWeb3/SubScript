/* Server-side helpers for the SubScriptVault escrow contract: chain reads, the
   off-chain mirror sync, and signers (user embedded wallet + keeper). */
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { pgMaybeOne } from "@/lib/serverPg";
import { decryptPrivateKey } from "@/lib/crypto";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import {
    SUBSCRIPT_VAULT_ADDRESS,
    SUBSCRIPT_VAULT_CHAIN_ID,
    USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

export const VAULT_ABI = [
    "function setRequiredCommit(uint256 amount)",
    "function requiredCommit(address merchant) view returns (uint256)",
    "function commit(address merchant, uint256 amount)",
    "function withdrawSurplus(address merchant, uint256 amount)",
    "function reclaimAbandonedEscrow(address merchant)",
    "function drawUsageFor(address merchant, address user, uint256 amount)",
    "function merchantClaim()",
    "function merchantClaimable(address merchant) view returns (uint256)",
    "function getVault(address user, address merchant) view returns (uint256 balance, uint256 owed, uint64 cycleStart, bool active, uint256 commitNeeded, uint64 lockedUntil)",
];

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

export type VaultState = {
    balance: bigint;
    owed: bigint;
    cycleStart: bigint;
    active: boolean;
    commitNeeded: bigint;
    lockedUntil: bigint;
};

function readProvider(): ethers.JsonRpcProvider {
    const url = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
    return new ethers.JsonRpcProvider(url);
}

export function vaultReadContract(provider?: ethers.Provider) {
    return new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, provider || readProvider());
}

export async function readVault(user: string, merchant: string): Promise<VaultState> {
    const c = vaultReadContract();
    const v = await c.getVault(user, merchant);
    return {
        balance: BigInt(v.balance ?? v[0]),
        owed: BigInt(v.owed ?? v[1]),
        cycleStart: BigInt(v.cycleStart ?? v[2]),
        active: Boolean(v.active ?? v[3]),
        commitNeeded: BigInt(v.commitNeeded ?? v[4]),
        lockedUntil: BigInt(v.lockedUntil ?? v[5] ?? 0),
    };
}

/** Read the vault from chain and upsert the metered_vaults mirror row. */
export async function syncVaultMirror(user: string, merchant: string): Promise<VaultState> {
    const normalizedUser = user.toLowerCase();
    const normalizedMerchant = merchant.toLowerCase();
    const v = await readVault(normalizedUser, normalizedMerchant);

    const cycleStart = v.cycleStart > BigInt(0) ? new Date(Number(v.cycleStart) * 1000) : null;
    const lockedUntil = v.lockedUntil > BigInt(0) ? new Date(Number(v.lockedUntil) * 1000) : null;
    await prisma.meteredVault.upsert({
        where: { userAddress_merchantAddress: { userAddress: normalizedUser, merchantAddress: normalizedMerchant } },
        update: {
            balanceUsdc: v.balance,
            owedUsdc: v.owed,
            commitUsdc: v.commitNeeded,
            cycleStart,
            lockedUntil,
            active: v.active,
            vaultChainId: SUBSCRIPT_VAULT_CHAIN_ID,
        },
        create: {
            userAddress: normalizedUser,
            merchantAddress: normalizedMerchant,
            balanceUsdc: v.balance,
            owedUsdc: v.owed,
            commitUsdc: v.commitNeeded,
            cycleStart,
            lockedUntil,
            active: v.active,
            vaultChainId: SUBSCRIPT_VAULT_CHAIN_ID,
        },
    });
    return v;
}

/** Build an ethers signer from a wallet's stored embedded key. Throws if unavailable. */
export async function getEmbeddedSigner(walletAddress: string): Promise<ethers.Wallet> {
    const record = await pgMaybeOne<{ encrypted_private_key: string | null }>(
        "select encrypted_private_key from user_embedded_wallets where wallet_address = $1 limit 1",
        [walletAddress.toLowerCase()]
    );
    if (!record?.encrypted_private_key) {
        throw new Error("This wallet has no server-held key. Connect a browser wallet to sign vault transactions.");
    }
    const { provider } = await getRpcProviderForWrite();
    const signer = new ethers.Wallet(decryptPrivateKey(record.encrypted_private_key), provider);
    if (signer.address.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error("Stored key does not match the active session wallet.");
    }
    return signer;
}

export function getKeeperSigner(): ethers.Wallet {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) {
        throw new Error("KEEPER_PRIVATE_KEY is not configured — cannot run vault draws.");
    }
    const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network");
    return new ethers.Wallet(key, provider);
}

/** Approve USDC to the vault (if needed) then commit `amount` micros for (user → merchant). */
export async function commitFromEmbedded(walletAddress: string, merchant: string, amount: bigint) {
    const signer = await getEmbeddedSigner(walletAddress);
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);
    const allowance: bigint = await usdc.allowance(signer.address, SUBSCRIPT_VAULT_ADDRESS);
    if (allowance < amount) {
        const approveTx = await usdc.approve(SUBSCRIPT_VAULT_ADDRESS, amount);
        await approveTx.wait();
    }
    const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.commit(merchant.toLowerCase(), amount);
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

export async function withdrawFromEmbedded(walletAddress: string, merchant: string, amount: bigint) {
    const signer = await getEmbeddedSigner(walletAddress);
    const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.withdrawSurplus(merchant.toLowerCase(), amount);
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Reclaim the full escrow from an abandoned (matured-but-unsettled past grace) vault. */
export async function reclaimAbandonedFromEmbedded(walletAddress: string, merchant: string) {
    const signer = await getEmbeddedSigner(walletAddress);
    const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.reclaimAbandonedEscrow(merchant.toLowerCase());
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

export async function setRequiredCommitFromEmbedded(merchantWallet: string, amount: bigint) {
    const signer = await getEmbeddedSigner(merchantWallet);
    const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.setRequiredCommit(amount);
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

export async function claimMerchantFromEmbedded(merchantWallet: string) {
    const signer = await getEmbeddedSigner(merchantWallet);
    const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.merchantClaim();
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}
