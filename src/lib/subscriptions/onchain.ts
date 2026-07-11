/* Server-side subscription actions on the standard contract, executed from the user's
   embedded wallet through the custody provider (legacy AES key or Circle MPC).
   createSubscription takes the first payment immediately (so the user must approve
   USDC first), mirroring the vault-commit approve+act pattern. */
import { ethers } from "ethers";
import { getWalletCustody, cancelSubscriptionIdempotencyKey } from "@/lib/custody";
import { ensureUsdcAllowance } from "@/lib/vault/onchain";
import { STANDARD_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const SUB_ABI = [
    "function createSubscription(address merchant, uint256 amount, uint256 period) returns (uint256)",
    "function cancelSubscription(uint256 subId)",
    "function modifySubscription(uint256 subId, uint256 newAmount, uint256 newPeriod)",
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive, address settlementToken, address paymentToken)",
    "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)",
];

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
];

function readProvider() {
    return new ethers.JsonRpcProvider(process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network");
}

export type OnChainSubscription = {
    subscriber: string;
    merchant: string;
    amount: bigint;
    period: bigint;
    nextPayment: bigint;
    isActive: boolean;
};

export async function getSubscriptionOnChain(subId: string | bigint): Promise<OnChainSubscription | null> {
    try {
        const c = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider());
        const s = await c.subscriptions(BigInt(subId));
        return {
            subscriber: String(s.subscriber ?? s[0]).toLowerCase(),
            merchant: String(s.merchant ?? s[1]).toLowerCase(),
            amount: BigInt(s.amount ?? s[2]),
            period: BigInt(s.period ?? s[3]),
            nextPayment: BigInt(s.nextPayment ?? s[4]),
            isActive: Boolean(s.isActive ?? s[5]),
        };
    } catch {
        return null;
    }
}

/* Belt-and-suspenders for the double-subscribe guard. The DB advisory-lock + mirror check in
   the subscribe route only sees subscriptions we ourselves mirrored; a sub that exists on-chain
   but was never mirrored (e.g. legacy, or a failed mirror write) would slip past it. This scans
   the chain directly — cheaply, via the `subscriber`+`merchant` indexed topics on
   SubscriptionCreated, so it reads only this pair's own creations — and returns the id of the
   first still-active one. Best-effort: any RPC error returns null so a transient failure never
   blocks a legitimate subscribe (the DB guard already covers the normal path). */
export async function findActiveOnChainSubscriptionId(
    subscriber: string,
    merchant: string,
): Promise<string | null> {
    try {
        const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider());
        const sub = subscriber.toLowerCase();
        const merch = merchant.toLowerCase();
        const filter = contract.filters.SubscriptionCreated(null, sub, merch);
        const logs = await contract.queryFilter(filter);
        for (const log of logs) {
            const subId = (log as ethers.EventLog).args?.subId;
            if (subId === undefined || subId === null) continue;
            const onChain = await getSubscriptionOnChain(subId);
            if (onChain && onChain.isActive && onChain.merchant === merch && onChain.subscriber === sub) {
                return subId.toString();
            }
        }
        return null;
    } catch (err) {
        console.error("[onchain] active-sub scan failed:", err instanceof Error ? err.message : err);
        return null;
    }
}

/* How many billing cycles of allowance to authorize up front. createSubscription only
   needs one period for the first charge, but the keeper debits each cycle against this
   same allowance (see cron/billing), so approving one period means the sub dies after
   one cycle. Approve ~1 year of cycles so recurring billing keeps working. */
function horizonAllowance(amount: bigint, period: bigint): bigint {
    const seconds = Number(period);
    const cyclesPerYear = Number.isFinite(seconds) && seconds > 0
        ? Math.max(1, Math.round((365.25 * 24 * 60 * 60) / seconds))
        : 1;
    return amount * BigInt(cyclesPerYear);
}

/* The custody provider has already waited for the transaction to confirm, so the receipt
   is normally available on the first read — the retries only cover read-endpoint lag. */
async function fetchReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    const provider = readProvider();
    for (let attempt = 0; attempt < 5; attempt++) {
        const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
        if (receipt) return receipt;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
}

export async function subscribeFromEmbedded(walletAddress: string, merchant: string, amount: bigint, period: bigint) {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, STANDARD_CONTRACT_ADDRESS, horizonAllowance(amount, period));
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: "createSubscription",
        args: [merchant.toLowerCase(), amount, period],
        /* No durable idempotency key here: a user who cancels and later re-subscribes to the same
           merchant is a legitimately distinct create, and a relationship-derived key would make
           Circle return the old (cancelled) transaction. The subscribe route's DB advisory-lock +
           on-chain active-sub scan guard against accidental duplicate active subs instead. */
    });

    /* Recover the new subId from the SubscriptionCreated event in the receipt. */
    const receipt = await fetchReceipt(txHash);
    const iface = new ethers.Interface(SUB_ABI);
    let subId: string | null = null;
    for (const log of receipt?.logs || []) {
        try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "SubscriptionCreated") {
                subId = parsed.args.subId.toString();
                break;
            }
        } catch {
            /* not our event */
        }
    }
    return { txHash, subId };
}

export async function cancelFromEmbedded(walletAddress: string, subId: string | bigint) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: "cancelSubscription",
        args: [BigInt(subId)],
        /* Idempotent by subId: cancelling the same sub twice is a no-op, so a retried cancel
           after a timed-out response must not submit a second transaction. Shared with the
           execute-tx cancel path via the custody helper so both derive the identical key. */
        idempotencyKey: cancelSubscriptionIdempotencyKey(STANDARD_CONTRACT_ADDRESS, subId),
    });
    return txHash;
}

/**
 * Change a subscription's amount/period in place (contract `modifySubscription`). This takes
 * NO payment — the current period stays as already paid; the next on-chain renewal bills the
 * new amount. We also raise the USDC allowance to cover the new annual horizon so recurring
 * billing keeps succeeding at the higher amount.
 */
export async function modifyFromEmbedded(
    walletAddress: string,
    subId: string | bigint,
    newAmount: bigint,
    newPeriod: bigint,
) {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, STANDARD_CONTRACT_ADDRESS, horizonAllowance(newAmount, newPeriod));
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: "modifySubscription",
        args: [BigInt(subId), newAmount, newPeriod],
    });
    return txHash;
}

/** Direct USDC transfer from the embedded wallet to a recipient — used to charge the
    prorated difference when a user upgrades immediately. Pass a deterministic idempotencyKey
    to make the charge safe against retries/concurrent requests: the custody provider returns the
    original transaction instead of moving funds a second time. */
export async function transferUsdcFromEmbedded(walletAddress: string, to: string, amountMicros: bigint, idempotencyKey?: string) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: USDC_NATIVE_GAS_ADDRESS,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to.toLowerCase(), amountMicros],
        ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return txHash;
}

/**
 * Prorated upgrade charge for the remainder of the current period:
 *   (newAmount - oldAmount) * (secondsRemaining / period), clamped to a single period.
 * Returns 0n for downgrades or once the period has lapsed.
 */
export function proratedUpgradeDelta(
    oldAmount: bigint,
    newAmount: bigint,
    period: bigint,
    nextPayment: bigint,
    nowSeconds: bigint,
): bigint {
    if (newAmount <= oldAmount || period <= BigInt(0)) return BigInt(0);
    let remaining = nextPayment - nowSeconds;
    if (remaining <= BigInt(0)) return BigInt(0);
    if (remaining > period) remaining = period;
    return ((newAmount - oldAmount) * remaining) / period;
}
