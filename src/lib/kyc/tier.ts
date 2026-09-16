import { prisma } from "@/lib/prisma";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";

export type KycTier = 0 | 1 | 2;

export interface KycTierInfo {
    tier: KycTier;
    tierLabel: string;
    isTier1: boolean;
    email: string | null;
    isEmbedded: boolean;
    hasKycApproval: boolean;
}

/**
 * Derives the canonical KYC Tier for any wallet address on SubScript.
 * 
 * Rules:
 * - Tier 0 (Basic): Unverified external wallet with no linked email. Read-only / cannot make financial transactions.
 * - Tier 1 (Verified): Required for all transactions (vault commits, deposits, payroll campaigns).
 *   - Embedded / MCP wallets: Created with emails by definition -> Tier 1 by default.
 *   - External wallets: Verified email linked via OTP -> Tier 1.
 * - Tier 2 (Enhanced): Full document KYC approval in kyc_verifications.
 */
export async function getAccountKycTier(walletAddress: string): Promise<KycTierInfo> {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress.trim())) {
        return {
            tier: 0,
            tierLabel: "Tier 0: Basic",
            isTier1: false,
            email: null,
            isEmbedded: false,
            hasKycApproval: false,
        };
    }

    const normalized = walletAddress.trim().toLowerCase();

    try {
        const [verifiedEmailRecord, custody, kycRecord] = await Promise.all([
            getVerifiedAccountEmail(normalized).catch(() => null),
            getWalletCustody(normalized).catch(() => null),
            prisma.kycVerification.findUnique({
                where: { walletAddress: normalized },
                select: { status: true },
            }).catch(() => null),

        ]);

        const isEmbedded = isCustodialWallet(custody);
        const email = verifiedEmailRecord?.email || null;
        const hasKycApproval = kycRecord?.status === "APPROVED";

        // MCP / Embedded wallets are obtained via email -> Tier 1 by default
        // External wallets require an OTP/OAuth-verified email -> Tier 1
        const hasEmail = Boolean(email) || isEmbedded;

        let tier: KycTier = 0;
        let tierLabel = "Tier 0: Basic";

        if (hasKycApproval) {
            tier = 2;
            tierLabel = "Tier 2: Enhanced";
        } else if (hasEmail) {
            tier = 1;
            tierLabel = "Tier 1: Verified";
        }

        return {
            tier,
            tierLabel,
            isTier1: tier >= 1,
            email,
            isEmbedded,
            hasKycApproval,
        };
    } catch (err) {
        console.error("Failed to derive KYC tier for wallet:", normalized, err);
        return {
            tier: 0,
            tierLabel: "Tier 0: Basic",
            isTier1: false,
            email: null,
            isEmbedded: false,
            hasKycApproval: false,
        };
    }
}
