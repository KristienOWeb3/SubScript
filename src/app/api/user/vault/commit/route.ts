/* User commits (escrows) USDC into a (user → merchant) vault. Clears any owed debt
   first, then restores the commit; the merchant's service activates for the cycle.
   Server-signed from the user's embedded wallet. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole, getAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { commitFromEmbedded, syncVaultMirror } from "@/lib/vault/onchain";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        const { merchantAddress, amountUsdc, acknowledgeUnverified } = body || {};
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const merchantRole = await getAccountRole(merchantAddress.toLowerCase());
        if (merchantRole !== "ENTERPRISE") {
            return NextResponse.json({ error: "Vaults can only be funded for merchant services." }, { status: 400 });
        }
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress.toLowerCase() },
            select: { tier: true, verified: true }
        });
        if (!merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Vault commits are only available for Premium (Tier 3) merchants." }, { status: 403 });
        }

        /* Informed consent for unverified merchants: metered vaults let the merchant draw reported
           usage up to the committed balance, so committing to a merchant SubScript hasn't verified
           carries real loss-of-funds risk. Require an explicit acknowledgment (client shows the
           warning) before escrowing, rather than silently proceeding. */
        if (!merchant.verified && acknowledgeUnverified !== true) {
            return NextResponse.json({
                error: "This merchant is not verified by SubScript.",
                code: "UNVERIFIED_MERCHANT",
                merchantVerified: false,
                warning: "This merchant has not been verified by SubScript. Committing funds lets them bill metered usage against your escrowed balance. Only commit to merchants you trust and have independently verified — funds lost to a fraudulent merchant may not be recoverable. Re-submit with acknowledgeUnverified: true to proceed.",
            }, { status: 409 });
        }
        const amount = parseUsdcToMicros(amountUsdc);
        if (amount <= BigInt(0)) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        /* Pay For Me: SubScript covers gas for the user committing to a merchant vault. */
        await requireGasSponsored(wallet.toLowerCase());

        /* commit escrows funds, so a retried request must reuse the same Circle idempotency key
           or it escrows twice. Keyed on the client's x-request-id (stable across its retries) —
           the amount is in the seed so a genuinely new commit for a different amount never
           collides even if a client re-sends a stale request id. */
        const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
        const txHash = await commitFromEmbedded(wallet, merchantAddress, amount,
            deterministicIdempotencyKey(`req:${requestId}:vault-commit:${wallet.toLowerCase()}:${merchantAddress.toLowerCase()}:${amount.toString()}`));
        const v = await syncVaultMirror(wallet, merchantAddress);
        /* A commit changes the balance denominator for usage thresholds, so re-arm the 50%/80%
           alerts against the new balance. */
        await prisma.meteredVault.updateMany({
            where: { userAddress: wallet.toLowerCase(), merchantAddress: merchantAddress.toLowerCase() },
            data: { usageNotifiedBps: 0 },
        }).catch(() => {});
        if (v.active) {
            await prisma.subscriptDm.updateMany({
                where: {
                    senderAddress: merchantAddress.toLowerCase(),
                    receiverAddress: wallet.toLowerCase(),
                    messageType: "COMMIT_EXHAUSTED",
                    status: "PENDING",
                },
                data: { status: "DISMISSED" },
            });
        }

        return NextResponse.json({
            success: true,
            txHash,
            vault: {
                balanceUsdc: v.balance.toString(),
                owedUsdc: v.owed.toString(),
                commitUsdc: v.commitNeeded.toString(),
                active: v.active,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to commit to vault" }, { status: 500 });
    }
}
