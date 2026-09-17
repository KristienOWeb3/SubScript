import { withPgClient } from "@/lib/serverPg";
import { formatUnits } from "ethers";
import { getAccountKycTier, KycTier } from "@/lib/kyc/tier";

export interface TierSpendingLimits {
    tier: KycTier;
    tierLabel: string;
    dailyLimitMicros: bigint;
    weeklyLimitMicros: bigint;
    monthlyLimitMicros: bigint;
}

/**
 * Canonical spending limits defined strictly by account KYC Tiers:
 * - Tier 0 (Basic / Unverified): $0 USDC (read-only; transfers forbidden).
 * - Tier 1 (Verified - Email / Embedded MPC): $2,500 / 24h, $10,000 / 7d, $25,000 / 30d.
 * - Tier 2 (Enhanced - Approved Document KYC): $100,000 / 24h, $500,000 / 7d, $1,000,000 / 30d.
 */
export const TIER_SPENDING_LIMITS: Record<KycTier, TierSpendingLimits> = {
    0: {
        tier: 0,
        tierLabel: "Tier 0: Basic",
        dailyLimitMicros: 0n,
        weeklyLimitMicros: 0n,
        monthlyLimitMicros: 0n,
    },
    1: {
        tier: 1,
        tierLabel: "Tier 1: Verified",
        dailyLimitMicros: 2_500_000_000n, // $2,500 USDC
        weeklyLimitMicros: 10_000_000_000n, // $10,000 USDC
        monthlyLimitMicros: 25_000_000_000n, // $25,000 USDC
    },
    2: {
        tier: 2,
        tierLabel: "Tier 2: Enhanced",
        dailyLimitMicros: 100_000_000_000n, // $100,000 USDC
        weeklyLimitMicros: 500_000_000_000n, // $500,000 USDC
        monthlyLimitMicros: 1_000_000_000_000n, // $1,000,000 USDC
    },
};

export interface SpendingReserveResult {
    allowed: boolean;
    operationId?: string;
    reason?: string;
    code?: string;
    tier?: KycTier;
    tierLabel?: string;
    limitPeriod?: "daily" | "weekly" | "monthly";
    currentSpentUsdc?: string;
    limitUsdc?: string;
    remainingUsdc?: string;
}

export interface AccountSpendingStatus {
    tier: KycTier;
    tierLabel: string;
    limits: {
        dailyUsdc: string;
        weeklyUsdc: string;
        monthlyUsdc: string;
    };
    spent: {
        dailyUsdc: string;
        weeklyUsdc: string;
        monthlyUsdc: string;
    };
    remaining: {
        dailyUsdc: string;
        weeklyUsdc: string;
        monthlyUsdc: string;
    };
}

function formatMicros(micros: bigint): string {
    return formatUnits(micros, 6);
}

/**
 * Derives a stable 32-bit integer lock key from a wallet address for pg_advisory_xact_lock.
 */
function advisoryLockKey(walletAddress: string): number {
    let hash = 0;
    const str = walletAddress.toLowerCase();
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return hash;
}

/**
 * Atomically checks spending limits governed strictly by the account's KYC Tier
 * against cumulative past spends plus active pending reservations, and reserves
 * the requested amount.
 *
 * Runs inside a PostgreSQL transaction with an advisory transaction lock on the wallet
 * address so concurrent requests cannot race past the tier ceiling.
 */
export async function checkAndReserveSpendingLimit(
    walletAddress: string,
    amountMicros: bigint,
    operationKind: string = "DIRECT_SEND",
): Promise<SpendingReserveResult> {
    if (amountMicros <= 0n) {
        return { allowed: false, reason: "Transfer amount must be positive.", code: "INVALID_AMOUNT" };
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const tierInfo = await getAccountKycTier(normalizedWallet);
    const tierLimits = TIER_SPENDING_LIMITS[tierInfo.tier] || TIER_SPENDING_LIMITS[0];

    // Tier 0 accounts have zero spending ceiling: require email link or KYC
    if (tierInfo.tier === 0) {
        return {
            allowed: false,
            reason: "Tier 0 accounts cannot transfer funds. Link a verified email or complete identity verification to unlock Tier 1 limits.",
            code: "TIER_VERIFICATION_REQUIRED",
            tier: tierInfo.tier,
            tierLabel: tierInfo.tierLabel,
            limitPeriod: "daily",
            currentSpentUsdc: "0",
            limitUsdc: "0",
            remainingUsdc: "0",
        };
    }

    return withPgClient(async (client) => {
        await client.query("BEGIN");
        try {
            // Serialize spending checks for this wallet across all concurrent requests
            const lockId = advisoryLockKey(normalizedWallet);
            await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);

            const dailyLimit = tierLimits.dailyLimitMicros;
            const weeklyLimit = tierLimits.weeklyLimitMicros;
            const monthlyLimit = tierLimits.monthlyLimitMicros;

            // Query cumulative spent amounts in rolling 24h, 7d, and 30d windows.
            // Spends in 'FINALIZED' or active 'PENDING' states within the window count against the cap.
            // Expired reservations (> 15 mins old without finalization) are ignored.
            const spentRes = await client.query(
                `SELECT
                    COALESCE(SUM(CASE
                        WHEN created_at >= statement_timestamp() - interval '24 hours'
                             AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                        THEN amount_usdc ELSE 0 END), 0)::text as daily_spent,
                    COALESCE(SUM(CASE
                        WHEN created_at >= statement_timestamp() - interval '7 days'
                             AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                        THEN amount_usdc ELSE 0 END), 0)::text as weekly_spent,
                    COALESCE(SUM(CASE
                        WHEN created_at >= statement_timestamp() - interval '30 days'
                             AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                        THEN amount_usdc ELSE 0 END), 0)::text as monthly_spent
                   FROM spending_limit_operations
                  WHERE lower(user_address) = $1
                    AND created_at >= statement_timestamp() - interval '30 days'`,
                [normalizedWallet],
            );

            const dailySpent = BigInt(spentRes.rows[0]?.daily_spent || "0");
            const weeklySpent = BigInt(spentRes.rows[0]?.weekly_spent || "0");
            const monthlySpent = BigInt(spentRes.rows[0]?.monthly_spent || "0");

            if (dailySpent + amountMicros > dailyLimit) {
                await client.query("ROLLBACK");
                const remaining = dailyLimit > dailySpent ? dailyLimit - dailySpent : 0n;
                return {
                    allowed: false,
                    reason: `Transfer of $${formatMicros(amountMicros)} USDC exceeds your ${tierInfo.tierLabel} daily limit of $${formatMicros(dailyLimit)} USDC (current 24h spent: $${formatMicros(dailySpent)} USDC).`,
                    code: "SPENDING_LIMIT_EXCEEDED",
                    tier: tierInfo.tier,
                    tierLabel: tierInfo.tierLabel,
                    limitPeriod: "daily",
                    currentSpentUsdc: formatMicros(dailySpent),
                    limitUsdc: formatMicros(dailyLimit),
                    remainingUsdc: formatMicros(remaining),
                };
            }

            if (weeklySpent + amountMicros > weeklyLimit) {
                await client.query("ROLLBACK");
                const remaining = weeklyLimit > weeklySpent ? weeklyLimit - weeklySpent : 0n;
                return {
                    allowed: false,
                    reason: `Transfer of $${formatMicros(amountMicros)} USDC exceeds your ${tierInfo.tierLabel} weekly limit of $${formatMicros(weeklyLimit)} USDC (current 7d spent: $${formatMicros(weeklySpent)} USDC).`,
                    code: "SPENDING_LIMIT_EXCEEDED",
                    tier: tierInfo.tier,
                    tierLabel: tierInfo.tierLabel,
                    limitPeriod: "weekly",
                    currentSpentUsdc: formatMicros(weeklySpent),
                    limitUsdc: formatMicros(weeklyLimit),
                    remainingUsdc: formatMicros(remaining),
                };
            }

            if (monthlySpent + amountMicros > monthlyLimit) {
                await client.query("ROLLBACK");
                const remaining = monthlyLimit > monthlySpent ? monthlyLimit - monthlySpent : 0n;
                return {
                    allowed: false,
                    reason: `Transfer of $${formatMicros(amountMicros)} USDC exceeds your ${tierInfo.tierLabel} monthly limit of $${formatMicros(monthlyLimit)} USDC (current 30d spent: $${formatMicros(monthlySpent)} USDC).`,
                    code: "SPENDING_LIMIT_EXCEEDED",
                    tier: tierInfo.tier,
                    tierLabel: tierInfo.tierLabel,
                    limitPeriod: "monthly",
                    currentSpentUsdc: formatMicros(monthlySpent),
                    limitUsdc: formatMicros(monthlyLimit),
                    remainingUsdc: formatMicros(remaining),
                };
            }

            // Spends are within tier limits: atomically reserve the operation
            const insertRes = await client.query(
                `INSERT INTO spending_limit_operations (
                    user_address, amount_usdc, operation_kind, status, created_at
                ) VALUES ($1, $2, $3, 'PENDING', now())
                RETURNING id`,
                [normalizedWallet, amountMicros.toString(), operationKind],
            );

            await client.query("COMMIT");
            return {
                allowed: true,
                operationId: insertRes.rows[0].id,
                tier: tierInfo.tier,
                tierLabel: tierInfo.tierLabel,
            };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        }
    });
}

/**
 * Fetches the current spending limit status and rolling spent amounts for a wallet.
 */
export async function getAccountSpendingStatus(walletAddress: string): Promise<AccountSpendingStatus> {
    const normalizedWallet = walletAddress.toLowerCase();
    const tierInfo = await getAccountKycTier(normalizedWallet);
    const tierLimits = TIER_SPENDING_LIMITS[tierInfo.tier] || TIER_SPENDING_LIMITS[0];

    const dailyLimit = tierLimits.dailyLimitMicros;
    const weeklyLimit = tierLimits.weeklyLimitMicros;
    const monthlyLimit = tierLimits.monthlyLimitMicros;

    return withPgClient(async (client) => {
        const spentRes = await client.query(
            `SELECT
                COALESCE(SUM(CASE
                    WHEN created_at >= statement_timestamp() - interval '24 hours'
                         AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                    THEN amount_usdc ELSE 0 END), 0)::text as daily_spent,
                COALESCE(SUM(CASE
                    WHEN created_at >= statement_timestamp() - interval '7 days'
                         AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                    THEN amount_usdc ELSE 0 END), 0)::text as weekly_spent,
                COALESCE(SUM(CASE
                    WHEN created_at >= statement_timestamp() - interval '30 days'
                         AND (status = 'FINALIZED' OR (status = 'PENDING' AND created_at >= statement_timestamp() - interval '15 minutes'))
                    THEN amount_usdc ELSE 0 END), 0)::text as monthly_spent
               FROM spending_limit_operations
              WHERE lower(user_address) = $1
                AND created_at >= statement_timestamp() - interval '30 days'`,
            [normalizedWallet],
        );

        const dailySpent = BigInt(spentRes.rows[0]?.daily_spent || "0");
        const weeklySpent = BigInt(spentRes.rows[0]?.weekly_spent || "0");
        const monthlySpent = BigInt(spentRes.rows[0]?.monthly_spent || "0");

        const dailyRemaining = dailyLimit > dailySpent ? dailyLimit - dailySpent : 0n;
        const weeklyRemaining = weeklyLimit > weeklySpent ? weeklyLimit - weeklySpent : 0n;
        const monthlyRemaining = monthlyLimit > monthlySpent ? monthlyLimit - monthlySpent : 0n;

        return {
            tier: tierInfo.tier,
            tierLabel: tierInfo.tierLabel,
            limits: {
                dailyUsdc: formatMicros(dailyLimit),
                weeklyUsdc: formatMicros(weeklyLimit),
                monthlyUsdc: formatMicros(monthlyLimit),
            },
            spent: {
                dailyUsdc: formatMicros(dailySpent),
                weeklyUsdc: formatMicros(weeklySpent),
                monthlyUsdc: formatMicros(monthlySpent),
            },
            remaining: {
                dailyUsdc: formatMicros(dailyRemaining),
                weeklyUsdc: formatMicros(weeklyRemaining),
                monthlyUsdc: formatMicros(monthlyRemaining),
            },
        };
    });
}

/**
 * Finalizes a reserved spending operation upon confirmed on-chain settlement.
 * If the actual settled amount was less than reserved (e.g. partial batch failure),
 * the record is updated to reflect only what settled.
 */
export async function finalizeSpendingLimitOperation(
    operationId: string,
    settledAmountMicros?: bigint,
): Promise<void> {
    if (!operationId) return;
    await withPgClient(async (client) => {
        if (settledAmountMicros !== undefined) {
            await client.query(
                `UPDATE spending_limit_operations
                    SET status = 'FINALIZED',
                        amount_usdc = $2,
                        finalized_at = now()
                  WHERE id = $1`,
                [operationId, settledAmountMicros.toString()],
            );
        } else {
            await client.query(
                `UPDATE spending_limit_operations
                    SET status = 'FINALIZED',
                        finalized_at = now()
                  WHERE id = $1`,
                [operationId],
            );
        }
    });
}

/**
 * Releases a reserved spending operation when an execution fails or is cancelled
 * before moving funds on-chain.
 */
export async function releaseSpendingLimitOperation(
    operationId: string,
): Promise<void> {
    if (!operationId) return;
    await withPgClient(async (client) => {
        await client.query(
            `UPDATE spending_limit_operations
                SET status = 'RELEASED',
                    finalized_at = now()
              WHERE id = $1 AND status = 'PENDING'`,
            [operationId],
        );
    });
}
