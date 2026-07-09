/* Merchant sets / reads the commit required to use their metered service.
   Set is server-signed from the merchant's embedded wallet (on-chain setRequiredCommit).

   Auth: a dashboard SESSION cookie OR a Bearer API key (sk_...), matching the documented
   `POST /api/merchant/vault/commit-config` step and its companion `/api/user/vault/report-usage`
   (which is also API-key authed). Setting the commit signs an on-chain tx from the merchant's
   server-held embedded wallet, so the API-key path works for embedded-wallet merchants; an
   external-wallet merchant must set it from the dashboard with their connected wallet. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { setRequiredCommitFromEmbedded, vaultReadContract } from "@/lib/vault/onchain";
import { prisma } from "@/lib/prisma";
import { hashSecretKey } from "@/lib/apiKeys";

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
        if (secretKey) {
            const apiKeyRecord = await prisma.apiKey.findFirst({
                where: {
                    revoked: false,
                    secretKeyHash: hashSecretKey(secretKey),
                },
            });
            if (apiKeyRecord) return apiKeyRecord.walletAddress.toLowerCase();
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
        const commit: bigint = await vaultReadContract().requiredCommit(wallet);
        return NextResponse.json({ success: true, commitUsdc: commit.toString() }, { status: 200 });
    } catch (error: any) {
        console.error("Read required commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to read commit" }, { status: 500 });
    }
}

export async function POST(request: Request) {
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

        const body = sanitizeInput(await request.json().catch(() => null));
        const amount = parseUsdcToMicros(body?.amountUsdc);
        if (amount < BigInt(0)) {
            return NextResponse.json({ error: "Commit must be zero or greater" }, { status: 400 });
        }

        const txHash = await setRequiredCommitFromEmbedded(wallet, amount);
        return NextResponse.json({ success: true, txHash, commitUsdc: amount.toString() }, { status: 200 });
    } catch (error: any) {
        console.error("Set required commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to set commit" }, { status: 500 });
    }
}
