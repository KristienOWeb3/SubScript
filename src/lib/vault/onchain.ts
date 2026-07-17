/* Server-side helpers for the SubScriptVault escrow contract: chain reads, the
   off-chain mirror sync, and embedded-wallet writes routed through the custody
   provider (legacy AES key or Circle MPC — see src/lib/custody). */
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getWalletCustody, type WalletCustody } from "@/lib/custody";
import {
    SUBSCRIPT_VAULT_ADDRESS,
    SUBSCRIPT_VAULT_CHAIN_ID,
    USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

/* The commitment/exposure policy is a platform constant (2 USDC per user→merchant
   relationship per cycle) — merchants have no on-chain lever to change it. */
export const VAULT_STANDARD_COMMIT_MICROS = BigInt(2_000_000);

export const VAULT_ABI = [
    "function STANDARD_COMMIT() view returns (uint256)",
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
    /* Keep the chain snapshot and cycle-local counters in one atomic upsert. A
       draw can succeed on-chain while the request dies before the old two-step
       reset; the next generic sync must therefore clear accrued usage whenever
       the chain advances (or closes) the cycle. */
    await prisma.$executeRaw`
        INSERT INTO public.metered_vaults (
            user_address,
            merchant_address,
            balance_usdc,
            owed_usdc,
            commit_usdc,
            cycle_start,
            locked_until,
            active,
            vault_chain_id,
            updated_at
        ) VALUES (
            ${normalizedUser},
            ${normalizedMerchant},
            ${v.balance},
            ${v.owed},
            ${v.commitNeeded},
            ${cycleStart},
            ${lockedUntil},
            ${v.active},
            ${SUBSCRIPT_VAULT_CHAIN_ID},
            now()
        )
        ON CONFLICT (user_address, merchant_address)
        DO UPDATE SET
            balance_usdc = EXCLUDED.balance_usdc,
            owed_usdc = EXCLUDED.owed_usdc,
            commit_usdc = EXCLUDED.commit_usdc,
            cycle_start = EXCLUDED.cycle_start,
            locked_until = EXCLUDED.locked_until,
            active = EXCLUDED.active,
            vault_chain_id = EXCLUDED.vault_chain_id,
            accrued_usage_usdc = CASE
                WHEN public.metered_vaults.cycle_start IS DISTINCT FROM EXCLUDED.cycle_start
                    OR EXCLUDED.active = false
                THEN 0
                ELSE public.metered_vaults.accrued_usage_usdc
            END,
            usage_notified_bps = CASE
                WHEN public.metered_vaults.cycle_start IS DISTINCT FROM EXCLUDED.cycle_start
                    OR EXCLUDED.active = false
                THEN 0
                ELSE public.metered_vaults.usage_notified_bps
            END,
            updated_at = now()
    `;
    return v;
}

/** Raise the wallet's USDC allowance to `spender` if it's below `amount`. Reads via RPC,
    writes through the custody provider so both legacy and Circle wallets work. */
export async function ensureUsdcAllowance(custody: WalletCustody, spender: string, amount: bigint) {
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, readProvider());
    const allowance: bigint = await usdc.allowance(custody.address, spender);
    if (allowance < amount) {
        await custody.executeContract({
            contractAddress: USDC_NATIVE_GAS_ADDRESS,
            abi: USDC_ABI,
            functionName: "approve",
            args: [spender, amount],
        });
    }
}

export function getKeeperSigner(): ethers.Wallet {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) {
        throw new Error("KEEPER_PRIVATE_KEY is not configured — cannot run vault draws.");
    }
    const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network");
    return new ethers.Wallet(key, provider);
}

/** Approve USDC to the vault (if needed) then commit `amount` micros for (user → merchant).
    `commit` moves funds, so the caller passes an attempt-scoped idempotencyKey — a retried
    request reusing the same key dedupes at Circle instead of escrowing twice. Top-ups to the
    same vault are legitimately repeatable, so the key must be per-attempt, never derived from
    just (user, merchant). */
export async function commitFromEmbedded(walletAddress: string, merchant: string, amount: bigint, idempotencyKey?: string) {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, SUBSCRIPT_VAULT_ADDRESS, amount);
    const { txHash } = await custody.executeContract({
        contractAddress: SUBSCRIPT_VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "commit",
        args: [merchant.toLowerCase(), amount],
        ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return txHash;
}

export async function withdrawFromEmbedded(walletAddress: string, merchant: string, amount: bigint) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: SUBSCRIPT_VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "withdrawSurplus",
        args: [merchant.toLowerCase(), amount],
    });
    return txHash;
}

/** Reclaim the full escrow from an abandoned (matured-but-unsettled past grace) vault. */
export async function reclaimAbandonedFromEmbedded(walletAddress: string, merchant: string) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: SUBSCRIPT_VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "reclaimAbandonedEscrow",
        args: [merchant.toLowerCase()],
    });
    return txHash;
}

/* setRequiredCommitFromEmbedded was removed with the platform-fixed 2 USDC policy:
   the contract no longer exposes a merchant-configurable commitment. */

export async function claimMerchantFromEmbedded(merchantWallet: string) {
    const custody = await getWalletCustody(merchantWallet);
    const { txHash } = await custody.executeContract({
        contractAddress: SUBSCRIPT_VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "merchantClaim",
        args: [],
    });
    return txHash;
}
