/* Chain-facing half of the subscription spending-authorization lifecycle.
 *
 * The arithmetic lives in allowanceRunway.ts (pure, unit-tested). This module is the part
 * that touches RPC and custody: reading the live allowance, and re-approving it for wallets
 * SubScript can sign for.
 *
 * See allowanceRunway.ts for why any of this exists.
 */
import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { getWalletCustody as custodyFor } from "@/lib/custody";
import { ensureUsdcAllowance } from "@/lib/vault/onchain";
import { horizonAllowance } from "@/lib/subscriptions/onchain";
import { projectRunway, type AllowanceRunway } from "@/lib/subscriptions/allowanceRunway";

export {
    projectRunway,
    lowAllowanceMessage,
    LOW_ALLOWANCE_CYCLES,
    EXTEND_BELOW_CYCLES,
    type AllowanceRunway,
} from "@/lib/subscriptions/allowanceRunway";

/* Read the live allowance and project it, on a caller-supplied provider. */
export async function readRunway(
    subscriber: string,
    chargeMicros: bigint,
    provider: ethers.Provider,
): Promise<AllowanceRunway> {
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ERC20_ABI, provider);
    const allowance: bigint = BigInt(await usdc.allowance(subscriber, STANDARD_CONTRACT_ADDRESS));
    return projectRunway(allowance, chargeMicros);
}

/* Raw allowance for a subscriber, using the shared read provider with fallback.
 *
 * The ERC-20 allowance is per (subscriber, PSA) — NOT per subscription. A wallet with three
 * subscriptions to three merchants draws all of them from this single pool, so read it once
 * per wallet and project each plan against it. Callers must not sum per-subscription figures;
 * that would count the same authorization several times over. */
export async function readSubscriberAllowance(subscriber: string): Promise<bigint> {
    const { result } = await executeWithRpcFallback(async (provider) => {
        const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ERC20_ABI, provider);
        return await usdc.allowance(subscriber, STANDARD_CONTRACT_ADDRESS);
    });
    return BigInt(result);
}

export type ExtensionOutcome =
    | { extended: true; approvedMicros: bigint }
    | { extended: false; reason: "not_needed" | "external_wallet" | "failed"; error?: string };

/* Re-approve a fresh horizon for a custodial subscriber.
 *
 * Deliberately re-approves the SAME horizon the subscription was created with — one year of
 * cycles at the CURRENT plan amount — rather than an unbounded approval. An infinite approval
 * would remove the ceiling the subscriber agreed to, and this runs unattended: the blast
 * radius of a compromised PSA has to stay bounded by something the customer consented to.
 *
 * This is executing the subscriber's existing intent, not widening it — they authorized this
 * recurring charge at this amount when they subscribed. It is only ever done for wallets
 * SubScript custodies; external wallets are advised and act themselves.
 *
 * Idempotent: ensureUsdcAllowance no-ops when the allowance already clears the target, so a
 * retried keeper run costs one RPC read and no transaction. */
export async function extendAllowanceForCustodial(args: {
    subscriber: string;
    amountMicros: bigint;
    periodSeconds: bigint;
}): Promise<ExtensionOutcome> {
    const { subscriber, amountMicros, periodSeconds } = args;
    if (amountMicros <= BigInt(0)) return { extended: false, reason: "not_needed" };

    try {
        if (!isCustodialWallet(await getWalletCustody(subscriber))) {
            return { extended: false, reason: "external_wallet" };
        }
    } catch (err) {
        return { extended: false, reason: "failed", error: err instanceof Error ? err.message : String(err) };
    }

    const target = horizonAllowance(amountMicros, periodSeconds);
    try {
        const custody = await custodyFor(subscriber);
        await ensureUsdcAllowance(custody, STANDARD_CONTRACT_ADDRESS, target);
        return { extended: true, approvedMicros: target };
    } catch (err) {
        /* Never fatal to the caller: a failed extension leaves the existing allowance intact,
           so the renewal still proceeds on whatever runway remains. */
        return { extended: false, reason: "failed", error: err instanceof Error ? err.message : String(err) };
    }
}
