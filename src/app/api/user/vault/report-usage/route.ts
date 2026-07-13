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
import {
    insertPgDm,
    pushDmNotification,
    type DmPushInput,
} from "@/lib/dms/notifications";

type VaultUsageRow = {
    id: string;
    balance_usdc: string;
    commit_usdc: string;
    owed_usdc: string;
    accrued_usage_usdc: string;
    active: boolean;
    usage_notified_bps: number;
};

type UsageResult =
    | { kind: "missing" }
    | { kind: "idempotency_conflict" }
    | { kind: "inactive"; vault: VaultUsageRow }
    | { kind: "exhausted"; vault: VaultUsageRow; remaining: bigint; notification: DmPushInput | null }
    | { kind: "accrued"; vault: VaultUsageRow; exhausted: boolean; notification: DmPushInput | null; thresholdNotification: DmPushInput | null };

/* Balance-usage thresholds (bps) that trigger a heads-up DM once each per cycle. 100% is covered
   separately by COMMIT_EXHAUSTED, so it's intentionally not listed here. */
const USAGE_THRESHOLD_BANDS = [5000, 8000];

const formatUsdc = (micros: bigint) => (Number(micros) / 1_000_000).toFixed(2);

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
    if (existing.rowCount > 0) return null;

    return insertPgDm(client, {
        sender_address: merchantAddress,
        receiver_address: userAddress,
        message_type: "COMMIT_EXHAUSTED",
        status: "PENDING",
        amount_usdc: commitUsdc.toString(),
        title: "Committed balance exhausted",
        description: "Your committed service balance is fully used. Re-commit before requesting more service.",
    });
}

async function insertThresholdNotification(
    client: any,
    merchantAddress: string,
    userAddress: string,
    bandBps: number,
    accrued: bigint,
    balance: bigint,
) {
    const pct = bandBps / 100;
    return insertPgDm(client, {
        sender_address: merchantAddress,
        receiver_address: userAddress,
        message_type: "USAGE_THRESHOLD",
        status: "PENDING",
        amount_usdc: accrued.toString(),
        title: `${pct}% of your committed balance used`,
        description: `This merchant has reported ${formatUsdc(accrued)} of your ${formatUsdc(balance)} USDC committed balance as used. Service continues until the balance is fully used — review the usage breakdown in your dashboard.`,
    });
}

async function accrueUsageAtomically(
    userAddress: string,
    merchantAddress: string,
    amountMicros: bigint,
    note: string | null,
    requestId: string,
): Promise<UsageResult> {
    return withPgClient(async (client) => {
        await client.query("begin");
        try {
            const selected = await client.query(
                `select id, balance_usdc, commit_usdc, owed_usdc, accrued_usage_usdc, active, usage_notified_bps
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

            const existingReport = await client.query(
                `select amount_usdc
                   from metered_usage_reports
                  where request_id = $1 and merchant_address = $2 and user_address = $3
                  limit 1`,
                [requestId, merchantAddress, userAddress],
            );
            if (existingReport.rowCount > 0) {
                await client.query("commit");
                if (BigInt(existingReport.rows[0].amount_usdc) !== amountMicros) return { kind: "idempotency_conflict" } as const;
                return { kind: "accrued", vault, exhausted: accrued >= balance, notification: null, thresholdNotification: null } as const;
            }

            if (!vault.active) {
                await client.query("commit");
                return { kind: "inactive", vault } as const;
            }

            const nextAccrued = accrued + amountMicros;
            if (nextAccrued > balance) {
                const notification = await insertExhaustionNotification(
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
                    notification,
                } as const;
            }

            const updated = await client.query(
                `update metered_vaults
                    set accrued_usage_usdc = $1,
                        updated_at = now()
                  where id = $2
              returning id, balance_usdc, commit_usdc, owed_usdc, accrued_usage_usdc, active, usage_notified_bps`,
                [nextAccrued.toString(), vault.id],
            );

            /* Append-only ledger row for this charge — the user's transparent record. */
            await client.query(
                `insert into metered_usage_reports
                     (vault_id, user_address, merchant_address, amount_usdc, accrued_after_usdc, balance_usdc, note, request_id)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [vault.id, userAddress, merchantAddress, amountMicros.toString(), nextAccrued.toString(), balance.toString(), note, requestId],
            );

            const exhausted = nextAccrued === balance;
            const notification = exhausted
                ? await insertExhaustionNotification(client, merchantAddress, userAddress, commit)
                : null;

            /* Fire a one-time heads-up when a 50%/80% band is first crossed this cycle. Skip when the
               balance is fully used — COMMIT_EXHAUSTED already covers that. Dedup is atomic via the
               usage_notified_bps high-water mark, which re-arms when the cycle resets (draw/commit). */
            let thresholdNotification: DmPushInput | null = null;
            if (!exhausted) {
                const alreadyNotified = Number(vault.usage_notified_bps ?? 0);
                const newBps = balance > BigInt(0) ? Number((nextAccrued * BigInt(10000)) / balance) : 10000;
                const band = [...USAGE_THRESHOLD_BANDS].reverse().find((b) => b <= newBps && b > alreadyNotified);
                if (band) {
                    await client.query(`update metered_vaults set usage_notified_bps = $1 where id = $2`, [band, vault.id]);
                    thresholdNotification = await insertThresholdNotification(client, merchantAddress, userAddress, band, nextAccrued, balance);
                }
            }

            await client.query("commit");
            return {
                kind: "accrued",
                vault: updated.rows[0] as VaultUsageRow,
                exhausted,
                notification,
                thresholdNotification,
            } as const;
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });
}

function scheduleDmPush(notification: DmPushInput | null) {
    if (!notification) return;
    after(() => pushDmNotification(notification));
}

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized: Missing API Key" }, { status: 401 });
        }
        const secretKey = authHeader.replace("Bearer ", "");

        const apiKeyRecord = await prisma.apiKey.findFirst({
            where: { secretKeyHash: hashSecretKey(secretKey) }
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
        const { userAddress, amountUsdc, amountUsdcMicros, note } = sanitizedBody;

        if (typeof userAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
            return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
        }

        /* Optional merchant-supplied line-item label for the user's ledger (e.g. "1.2M API calls"). */
        const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null;

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
        const requestIdHeader = request.headers.get("x-request-id")?.trim();
        if (requestIdHeader && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestIdHeader)) {
            return NextResponse.json({ error: "Invalid x-request-id" }, { status: 400 });
        }
        const requestId = requestIdHeader || crypto.randomUUID();

        const result = await accrueUsageAtomically(normalizedUser, merchantAddress, amountMicros, cleanNote, requestId);

        if (result.kind === "missing") {
            return NextResponse.json({
                error: "No vault for this user. Ask them to commit to your service before reporting usage.",
                code: "NO_VAULT",
            }, { status: 404 });
        }

        if (result.kind === "idempotency_conflict") {
            return NextResponse.json({ error: "This request id was already used for a different usage charge." }, { status: 409 });
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
            scheduleDmPush(result.notification);
            return NextResponse.json({
                error: "Committed balance exhausted. The user must re-commit to keep using the service.",
                code: "COMMIT_EXHAUSTED",
                commitUsdc: result.vault.commit_usdc,
                balanceUsdc: result.vault.balance_usdc,
                accruedUsageUsdc: result.vault.accrued_usage_usdc,
                remainingUsdc: result.remaining.toString(),
            }, { status: 402 });
        }

        scheduleDmPush(result.notification);
        scheduleDmPush(result.thresholdNotification);

        return NextResponse.json({
            success: true,
            active: result.vault.active,
            exhausted: result.exhausted,
            requestId,
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
