/* Arc network-fee estimation for USER-PAID transactions (peer sends, user withdrawals).
 *
 * On Circle SCA wallets the on-chain gas is fronted by Circle Gas Station; there is no per-tx
 * user-pay in the SDK. So a user-paid Arc send is settled with fee-recovery: we estimate the real
 * Arc network fee and debit it from the sender in USDC (see @/lib/sponsor/userPaidTransfer). This
 * module produces that estimate from live gas data — never a fixed markup.
 *
 * Arc's native gas currency is USDC, denominated at 18 decimals at the RPC/EVM level (verified in
 * @/lib/sponsor/gas). ERC-20 USDC amounts elsewhere in the app are 6-decimal "micros", so the
 * estimate is converted from 18dp native wei to 6dp micros by dividing by 1e12.
 */
import { executeWithRpcFallback } from "@/lib/payments/rpc";

/* Generous per-USDC-transfer gas allowance. Includes ERC-4337 SCA overhead so the fee we charge is
   never smaller than the gas actually consumed on Arc. */
const TRANSFER_GAS_UNITS = 65_000n;
/* 1e12: 18dp native gas wei → 6dp USDC micros. */
const WEI_PER_MICRO = 1_000_000_000_000n;
/* Bounds so a bad/again-throttled RPC read can never over- or under-charge. Floor keeps a real cost
   attached even if getFeeData briefly reports 0; cap prevents a spurious spike from billing the user. */
const FEE_FLOOR_MICROS = 2_000n;   // 0.002 USDC
const FEE_CAP_MICROS = 50_000n;    // 0.05 USDC

function formatMicros(micros: bigint): string {
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

export interface NetworkFeeEstimate {
    feeMicros: bigint;
    feeUsdc: string;
    /* True when the estimate fell back to the floor because live gas data was unavailable. */
    fallback: boolean;
}

/**
 * Estimate the Arc network fee (in USDC micros) to charge a user for `transfers` primary transfer(s)
 * PLUS the one fee-recovery transfer that moves the fee itself. Read-only and never throws — a failed
 * gas read returns the bounded floor so a send is never blocked on estimation.
 */
export async function estimateArcNetworkFeeMicros(transfers = 1): Promise<NetworkFeeEstimate> {
    /* +1 leg: the fee-recovery transfer is itself an on-chain USDC transfer whose gas the user should
       also cover, so the recipient always receives the full amount and the platform is made whole. */
    const legs = BigInt(Math.max(1, Math.floor(transfers))) + 1n;

    let gasPriceWei = 0n;
    let fallback = false;
    try {
        const { result: feeData } = await executeWithRpcFallback((provider) => provider.getFeeData());
        const raw = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
        gasPriceWei = BigInt(raw.toString());
    } catch (error) {
        console.warn("[network-fee] gas price read failed; using floor estimate:", error instanceof Error ? error.message : error);
        fallback = true;
    }

    let feeMicros = (gasPriceWei * TRANSFER_GAS_UNITS * legs) / WEI_PER_MICRO;
    if (feeMicros < FEE_FLOOR_MICROS) {
        feeMicros = FEE_FLOOR_MICROS;
        if (gasPriceWei === 0n) fallback = true;
    }
    if (feeMicros > FEE_CAP_MICROS) feeMicros = FEE_CAP_MICROS;

    return { feeMicros, feeUsdc: formatMicros(feeMicros), fallback };
}
