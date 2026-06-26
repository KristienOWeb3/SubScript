/* Server-side subscription actions on the standard contract, signed from the user's
   embedded wallet. createSubscription takes the first payment immediately (so the user
   must approve USDC first), mirroring the vault-commit approve+act pattern. */
import { ethers } from "ethers";
import { getEmbeddedSigner } from "@/lib/vault/onchain";
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

export async function subscribeFromEmbedded(walletAddress: string, merchant: string, amount: bigint, period: bigint) {
    const signer = await getEmbeddedSigner(walletAddress);
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);
    const allowance: bigint = await usdc.allowance(signer.address, STANDARD_CONTRACT_ADDRESS);
    const desiredAllowance = horizonAllowance(amount, period);
    if (allowance < desiredAllowance) {
        const approveTx = await usdc.approve(STANDARD_CONTRACT_ADDRESS, desiredAllowance);
        await approveTx.wait();
    }
    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, signer);
    const tx = await contract.createSubscription(merchant.toLowerCase(), amount, period);
    const receipt = await tx.wait();

    let subId: string | null = null;
    for (const log of receipt?.logs || []) {
        try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name === "SubscriptionCreated") {
                subId = parsed.args.subId.toString();
                break;
            }
        } catch {
            /* not our event */
        }
    }
    return { txHash: receipt?.hash || tx.hash, subId };
}

export async function cancelFromEmbedded(walletAddress: string, subId: string | bigint) {
    const signer = await getEmbeddedSigner(walletAddress);
    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, signer);
    const tx = await contract.cancelSubscription(BigInt(subId));
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
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
    const signer = await getEmbeddedSigner(walletAddress);
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);
    const allowance: bigint = await usdc.allowance(signer.address, STANDARD_CONTRACT_ADDRESS);
    const desiredAllowance = horizonAllowance(newAmount, newPeriod);
    if (allowance < desiredAllowance) {
        const approveTx = await usdc.approve(STANDARD_CONTRACT_ADDRESS, desiredAllowance);
        await approveTx.wait();
    }
    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, signer);
    const tx = await contract.modifySubscription(BigInt(subId), newAmount, newPeriod);
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
}

/** Direct USDC transfer from the embedded wallet to a recipient — used to charge the
    prorated difference when a user upgrades immediately. */
export async function transferUsdcFromEmbedded(walletAddress: string, to: string, amountMicros: bigint) {
    const signer = await getEmbeddedSigner(walletAddress);
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);
    const tx = await usdc.transfer(to.toLowerCase(), amountMicros);
    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
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
