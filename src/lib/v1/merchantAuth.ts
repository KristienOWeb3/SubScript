import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { hashSecretKey, isLiveModeEnabled } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";

export type MerchantAuth =
    | { ok: true; merchantAddress: string; mode: "test" | "live" | "session" }
    | { ok: false; status: number; error: string };

/**
 * Authenticates credentials and returns the merchant identity ONLY.
 * Role and entitlement verification are distinct subsequent checks.
 */
export async function authenticateMerchant(request: Request): Promise<MerchantAuth> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { ok: true, merchantAddress: sessionWallet.toLowerCase(), mode: "session" };
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, error: "Unauthorized: Missing or invalid Authorization header" };
    }
    const secretKey = authHeader.substring(7).trim();
    const mode = getSecretKeyMode(secretKey);
    if (mode !== "test" && mode !== "live") {
        return { ok: false, status: 401, error: "Unauthorized: Invalid secret API key format" };
    }
    if (mode === "live" && !isLiveModeEnabled()) {
        return { ok: false, status: 401, error: "Unauthorized: sk_live_ keys are not enabled on this deployment" };
    }
    const keyRecord = await prisma.apiKey.findFirst({
        where: { revoked: false, secretKeyHash: hashSecretKey(secretKey) },
    });
    if (!keyRecord) {
        return { ok: false, status: 401, error: "Unauthorized: Active secret key not found" };
    }
    const expectedMode = mode === "live" ? "LIVE" : "TEST";
    if (keyRecord.mode !== expectedMode) {
        return { ok: false, status: 403, error: "Forbidden: this API key's mode cannot settle on this deployment" };
    }
    // Check current entitlement for API key access
    if (mode !== "test") {
        const { getAccountKycTier } = await import("@/lib/kyc/tier");
        const tierInfo = await getAccountKycTier(keyRecord.walletAddress.toLowerCase());
        if (tierInfo.tier < 1) {
            return { ok: false, status: 403, error: "API key access requires Tier 1 verification (link a verified email)." };
        }
    }
    return { ok: true, merchantAddress: keyRecord.walletAddress.toLowerCase(), mode };
}

export async function checkMerchantTier1(walletAddress: string): Promise<boolean> {
    const { getAccountKycTier } = await import("@/lib/kyc/tier");
    const tierInfo = await getAccountKycTier(walletAddress);
    return tierInfo.tier >= 1;
}

/**
 * Enforces role and entitlement validation. In test mode or session evaluation,
 * testnet merchants are permitted to test recurring checkouts and DM plans.
 */
export async function requireEnterpriseAndTier1(
    merchantAddress: string,
    mode?: "test" | "live" | "session"
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const role = await resolveAccountRoleWithBackfill(merchantAddress);
    if (!role || role !== "ENTERPRISE") {
        await prisma.merchant.upsert({
            where: { walletAddress: merchantAddress.toLowerCase() },
            create: { walletAddress: merchantAddress.toLowerCase(), tier: "FREE" },
            update: {},
        }).catch(() => null);
    }
    const isTier1 = await checkMerchantTier1(merchantAddress);
    if (!isTier1 && mode !== "test") {
        return { ok: false, status: 403, error: "Forbidden: This action requires Tier 1 verification (link a verified email)." };
    }
    return { ok: true };
}
