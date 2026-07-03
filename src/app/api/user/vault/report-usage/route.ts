/* Merchant reports metered usage against a user's vault.
 *
 * New escrow model: usage ACCRUES during the cycle (it is not debited per call). The
 * merchant draws the accrued total from the escrow at cycle end (keeper -> drawUsageFor).
 * This endpoint also GATES access: if the vault is inactive (owed debt, or balance below
 * the required commit) it refuses usage until the user re-commits. Gating reads the
 * on-chain mirror, which the commit/withdraw/draw flows keep in sync.
 */
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { hashSecretKey } from "@/lib/apiKeys";
import { withPgClient } from "@/lib/serverPg";
import { sendPushToWallet } from "@/lib/push";

type VaultUsageRow = {
    id: string;
    balance_usdc: string;
    commit_usdc: string;
    owed_usdc: string;
    accrued_usage_usdc: string;
    active: boolean;
};

type UsageResult =
    | { kind: "missing" }
    | { kind: "inactive"; vault: VaultUsageRow }
    | { kind: "exhausted"; vault: VaultUsageRow; remaining: bigint; notificationCreated: boolean }
    | { kind: "accrued"; vault: VaultUsageRow; exhausted: boolean; notificationCreated: boolean };

async function insertExhaustionNotification(
    client: any,
    merchantAddress: string,
    userAddress: string,
    commitUsdc: bigint,
) {
    const existing = await client.query(
        `select id
           from subscript_dms
          where sender_address = $1
            and receiver_address = $2
            and message_type = 'COMMIT_EXHAUSTED'
            and status = 'PENDING'
          limit 1`,
        [merchantAddress, userAddress],
    );
    if (existing.rowCount > 0) return false;

    await client.query(
        `insert into subscript_dms
            (sender_address, receiver_address, message_type, status, amount_usdc, title, description)
         values ($1, $2, 'COMMIT_EXHAUSTED', 'PENDING', $3, $4, $5)`,
        [
            merchantAddress,
            userAddress,
            commitUsdc.toString(),
            "Committed balance exhausted",
            "Your committed service balance is fully used. Re-commit before requesting more service.",
        ],
    );
    return true;
}

async function accrueUsageAtomically(
    userAddress: string,
    merchantAddress: string,
    amountMicros: bigint,
): Promise<UsageResult> {
    return withPgClient(async (client) => {
        await client.query("begin");
        try {
            const selected = await client.query(
                `select id, balance_usdc, commit_usdc, owed_usdc, accrued_usage_usdc, active
                   from metered_vaults
                  where user_address = $1 and merchant_address = $2
                  for update`,
                [userAddress, merchantAddress],
            );
            if (selected.rowCount === 0) {
                await client.query("commit");
                return { kind: "missing" } as const;
            }

            const vault = selected.rows[0] as VaultUsageRow;
            const balance = BigInt(vault.balance_usdc);
            const accrued = BigInt(vault.accrued_usage_usdc);
            const commit = BigInt(vault.commit_usdc);

            if (!vault.active) {
                await client.query("commit");
                return { kind: "inactive", vault } as const;
            }

            const nextAccrued = accrued + amountMicros;
            if (nextAccrued > balance) {
                const notificationCreated = await insertExhaustionNotification(
                    client,
                    merchantAddress,
                    userAddress,
                    commit,
                );
                await client.query("commit");
                return {
                    kind: "exhausted",
                    vault,
                    remaining: balance > accrued ? balance - accrued : BigInt(0),
                    notificationCreated,
                } as const;
            }

            const updated = await client.query(
                `update metered_vaults
                    set accrued_usage_usdc = $1,
                        updated_at = now()
                  where id = $2
              returning id, balance_usdc, commit_usdc, owed_usdc, accrued_usage_usdc, active`,
                [nextAccrued.toString(), vault.id],
            );
            const exhausted = nextAccrued === balance;
            const notificationCreated = exhausted
                ? await insertExhaustionNotification(client, merchantAddress, userAddress, commit)
                : false;

            await client.query("commit");
            return {
                kind: "accrued",
                vault: updated.rows[0] as VaultUsageRow,
                exhausted,
                notificationCreated,
            } as const;
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });
}

function scheduleExhaustionPush(userAddress: string, merchantAddress: string, created: boolean) {
    if (!created) return;
    after(() =>
        sendPushToWallet(userAddress, {
            title: "Committed balance exhausted",
            body: "Re-commit before requesting more service.",
            url: `/user?tab=inbox&chat=${merchantAddress}`,
            tag: `commit-exhausted-${merchantAddress}`,
        }),
    );
}

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

        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress },
            select: { tier: true }
        });
        if (!merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: API keys and usage reporting require a Premium (Tier 3) merchant plan." }, { status: 403 });
        }

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

        const result = await accrueUsageAtomically(normalizedUser, merchantAddress, amountMicros);

        if (result.kind === "missing") {
            return NextResponse.json({
                error: "No vault for this user. Ask them to commit to your service before reporting usage.",
                code: "NO_VAULT",
            }, { status: 404 });
        }

        if (result.kind === "inactive") {
            return NextResponse.json({
                error: "Vault inactive. The user must commit to your service before using it again.",
                code: "VAULT_INACTIVE",
                commitUsdc: result.vault.commit_usdc,
                balanceUsdc: result.vault.balance_usdc,
            }, { status: 402 });
        }

        if (result.kind === "exhausted") {
            scheduleExhaustionPush(normalizedUser, merchantAddress, result.notificationCreated);
            return NextResponse.json({
                error: "Committed balance exhausted. The user must re-commit to keep using the service.",
                code: "COMMIT_EXHAUSTED",
                commitUsdc: result.vault.commit_usdc,
                balanceUsdc: result.vault.balance_usdc,
                accruedUsageUsdc: result.vault.accrued_usage_usdc,
                remainingUsdc: result.remaining.toString(),
            }, { status: 402 });
        }

        scheduleExhaustionPush(normalizedUser, merchantAddress, result.notificationCreated);

        return NextResponse.json({
            success: true,
            active: result.vault.active,
            exhausted: result.exhausted,
            accruedUsageUsdc: result.vault.accrued_usage_usdc,
            balanceUsdc: result.vault.balance_usdc,
            commitUsdc: result.vault.commit_usdc,
            owedUsdc: result.vault.owed_usdc,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Usage reporting error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
