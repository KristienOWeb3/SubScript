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
        const { userAddress, amountUsdc, amountUsdcMicros } = sanitizedBody;

        if (typeof userAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
            return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
        }

        /* Canonical unit is integer micro-USDC (`amountUsdcMicros`), consistent with /intent and
           /v1/subscriptions. The legacy decimal `amountUsdc` is still accepted for compatibility.
           Reject non-string/non-finite inputs before BigInt so e.g. `true` or "Infinity" 400 cleanly. */
        let amountMicros: bigint;
        if (amountUsdcMicros !== undefined && amountUsdcMicros !== null && amountUsdcMicros !== "") {
            if (typeof amountUsdcMicros !== "string" || !/^\d+$/.test(amountUsdcMicros)) {
                return NextResponse.json({ error: "Invalid amountUsdcMicros (must be an integer micro-USDC string)" }, { status: 400 });
            }
            amountMicros = BigInt(amountUsdcMicros);
        } else if (amountUsdc !== undefined && amountUsdc !== null && amountUsdc !== "") {
            const legacyAmount = typeof amountUsdc === "number" || typeof amountUsdc === "string" ? Number(amountUsdc) : NaN;
            if (!Number.isFinite(legacyAmount)) {
                return NextResponse.json({ error: "Invalid consumption amount" }, { status: 400 });
            }
            amountMicros = BigInt(Math.round(legacyAmount * 1_000_000));
        } else {
            return NextResponse.json({ error: "Invalid consumption amount" }, { status: 400 });
        }
        if (amountMicros <= BigInt(0)) {
            return NextResponse.json({ error: "Invalid consumption amount" }, { status: 400 });
        }

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

        // Gate: an inactive vault (below the required commit) cannot be used.
        if (!vault.active) {
            return NextResponse.json({
                error: "Vault inactive. The user must commit to your service before using it again.",
                code: "VAULT_INACTIVE",
                commitUsdc: vault.commitUsdc.toString(),
                balanceUsdc: vault.balanceUsdc.toString(),
            }, { status: 402 });
        }

        // Cap usage at the committed escrow — never let usage exceed what was committed
        // (no debt/negative balance). When the commit is exhausted, service stops.
        if (vault.accruedUsageUsdc + amountMicros > vault.balanceUsdc) {
            const remaining = vault.balanceUsdc - vault.accruedUsageUsdc;
            return NextResponse.json({
                error: "Committed balance exhausted. The user must re-commit to keep using the service.",
                code: "COMMIT_EXHAUSTED",
                commitUsdc: vault.commitUsdc.toString(),
                balanceUsdc: vault.balanceUsdc.toString(),
                accruedUsageUsdc: vault.accruedUsageUsdc.toString(),
                remainingUsdc: (remaining > BigInt(0) ? remaining : BigInt(0)).toString(),
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
