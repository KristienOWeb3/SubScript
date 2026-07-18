/* Merchant reads the vault commitment policy.
 *
 * The commitment is a PLATFORM CONSTANT (2 USDC per user→merchant relationship per cycle)
 * — it is not merchant-configurable, on-chain or off. The old setRequiredCommit lever was
 * removed from SubScriptVault: a merchant must not be able to raise the cheque a user's
 * escrow writes, and a user's surplus never expands what the merchant can draw.
 *
 * Auth: a dashboard SESSION cookie OR a Bearer API key (sk_...), matching the companion
 * `/api/user/vault/report-usage`. The merchant identity always comes from the credential. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { VAULT_STANDARD_COMMIT_MICROS } from "@/lib/vault/onchain";
import { prisma } from "@/lib/prisma";
import { hashSecretKey, resolveSecretKeyMode } from "@/lib/apiKeys";

export const maxDuration = 120;

/* Resolve the acting merchant from a dashboard session or a Bearer API key. Returns the
   lowercased wallet address, or null if neither is present/valid. The merchant identity always
   comes from the credential (never from the request body), so there is no cross-account risk. */
async function resolveMerchant(request: Request): Promise<string | null> {
    const session = await getSessionWallet(request.headers);
    if (session) return session.toLowerCase();

    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
        const secretKey = authHeader.slice(7).trim();
        if (secretKey && resolveSecretKeyMode(secretKey) === "TEST") {
            const apiKeyRecord = await prisma.apiKey.findFirst({
                where: {
                    revoked: false,
                    secretKeyHash: hashSecretKey(secretKey),
                },
            });
            if (apiKeyRecord && apiKeyRecord.mode === "TEST") {
                return apiKeyRecord.walletAddress.toLowerCase();
            }
        }
    }
    return null;
}

export async function GET(request: Request) {
    try {
        const wallet = await resolveMerchant(request);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: wallet },
            select: { tier: true }
        });
        if (!merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Vault configurations are only available for Premium (Tier 3) merchants." }, { status: 403 });
        }
        return NextResponse.json({
            success: true,
            commitUsdc: VAULT_STANDARD_COMMIT_MICROS.toString(),
            policy: "PLATFORM_FIXED",
            note: "The vault commitment and per-cycle drawable exposure are fixed at 2 USDC per user by the platform.",
        }, { status: 200 });
    } catch (error: any) {
        console.error("Read commit policy failed:", error);
        return NextResponse.json({ error: error.message || "Failed to read commit" }, { status: 500 });
    }
}

export async function POST() {
    /* Explicit contract for integrators that still call the old setter. */
    return NextResponse.json({
        error: "The vault commitment is platform-fixed at 2 USDC per user and can no longer be configured by merchants.",
        code: "COMMIT_POLICY_PLATFORM_FIXED",
        commitUsdc: VAULT_STANDARD_COMMIT_MICROS.toString(),
    }, { status: 410 });
}
