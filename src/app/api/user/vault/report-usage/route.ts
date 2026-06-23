/* Merchant reports metered usage against a user's vault.
 *
 * New escrow model: usage ACCRUES during the cycle (it is not debited per call). The
 * merchant draws the accrued total from the escrow at cycle end (keeper -> drawUsageFor).
 * This endpoint also GATES access: if the vault is inactive (owed debt, or balance below
 * the required commit) it refuses usage until the user re-commits. Gating reads the
 * on-chain mirror, which the commit/withdraw/draw flows keep in sync.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { hashSecretKey } from "@/lib/apiKeys";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized: Missing API Key" }, { status: 401 });
        }
        const secretKey = authHeader.replace("Bearer ", "");

        const apiKeyRecord = await prisma.apiKey.findFirst({
            where: { OR: [{ secretKeyHash: hashSecretKey(secretKey) }, { secretKeyPlain: secretKey }] }
        });
        if (!apiKeyRecord || apiKeyRecord.revoked) {
            return NextResponse.json({ error: "Unauthorized: Invalid or revoked API Key" }, { status: 401 });
        }

        const merchantAddress = apiKeyRecord.walletAddress.toLowerCase();

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { userAddress, amountUsdc } = sanitizedBody;

        if (typeof userAddress !== "string" || !userAddress.startsWith("0x") || userAddress.length !== 42) {
            return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
        }
        if (!amountUsdc || isNaN(Number(amountUsdc)) || Number(amountUsdc) <= 0) {
            return NextResponse.json({ error: "Invalid consumption amount" }, { status: 400 });
        }

        const amountMicros = BigInt(Math.round(Number(amountUsdc) * 1_000_000));
        const normalizedUser = userAddress.toLowerCase();

        const vault = await prisma.meteredVault.findUnique({
            where: {
                userAddress_merchantAddress: { userAddress: normalizedUser, merchantAddress }
            }
        });

        if (!vault) {
            return NextResponse.json({
                error: "No vault for this user. Ask them to commit to your service before reporting usage.",
                code: "NO_VAULT",
            }, { status: 404 });
        }

        // Gate: an inactive vault (owed debt or below the required commit) cannot be used.
        if (!vault.active) {
            return NextResponse.json({
                error: "Vault inactive. The user must re-commit (clear any owed balance and restore the commit) before using the service again.",
                code: "VAULT_INACTIVE",
                owedUsdc: vault.owedUsdc.toString(),
                commitUsdc: vault.commitUsdc.toString(),
                balanceUsdc: vault.balanceUsdc.toString(),
            }, { status: 402 });
        }

        // Accrue usage for the current cycle; the keeper draws it at cycle end.
        const updated = await prisma.meteredVault.update({
            where: { id: vault.id },
            data: { accruedUsageUsdc: vault.accruedUsageUsdc + amountMicros }
        });

        return NextResponse.json({
            success: true,
            active: updated.active,
            accruedUsageUsdc: updated.accruedUsageUsdc.toString(),
            balanceUsdc: updated.balanceUsdc.toString(),
            commitUsdc: updated.commitUsdc.toString(),
            owedUsdc: updated.owedUsdc.toString(),
        }, { status: 200 });
    } catch (err: any) {
        console.error("Usage reporting error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
