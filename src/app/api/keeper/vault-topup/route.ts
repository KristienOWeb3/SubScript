/* Keeper job: refill metered vaults whose remaining balance fell below the user's threshold,
   under the mandate they granted at POST /api/user/vault/auto-topup.

   Auth: Bearer CRON_SECRET | KEEPER_SECRET. Signs from the USER's custodial wallet via Circle
   MPC — not from a platform key — so every gate below stands between an automated job and
   somebody else's money. They run in cheapest-and-most-definitive-first order, and all of them
   run before anything is submitted.

   Money-movement doctrine inherited from cron/customer-billing and vault/commit:
     - persist chain finality BEFORE any fallible side effect (mirror sync, DM, webhook);
     - a custody error after submission is AMBIGUOUS, never a clean failure — keep the intent open
       and reuse its idempotency key so a retry dedupes at Circle instead of committing twice;
     - expected shortfalls (no funds, cap reached) are a 200 outcome, not a 500. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    commitFromEmbedded,
    syncVaultMirror,
    readUsdcAllowance,
    readUsdcBalance,
} from "@/lib/vault/onchain";
import { SUBSCRIPT_VAULT_ADDRESS, SUBSCRIPT_VAULT_CHAIN_ID } from "@/lib/contracts/constants";
import { getWalletCustody, deterministicIdempotencyKey } from "@/lib/custody";
import { ensureSponsoredGas } from "@/lib/sponsor/sponsorship";
import { isAccountHalted } from "@/lib/accountHalt";
import { withPgClient } from "@/lib/serverPg";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import { merchantDisplayName } from "@/lib/identityDisplay";
import {
    remainingMicros,
    isMonthlyWindowStale,
    nextMonthlyWindow,
    followingMonthlyWindow,
    failureMessage,
    type AutoTopUpFailureCode,
} from "@/lib/vault/autoTopUp";
import crypto from "crypto";

export const maxDuration = 300;

/* Bounded so a backlog cannot run the function past maxDuration mid-commit. Anything beyond this
   batch is reported as backlog and picked up by the next sweep (every 15 minutes). */
const BATCH_LIMIT = 100;

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));

    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

type VaultRow = Awaited<ReturnType<typeof prisma.meteredVault.findMany>>[number];

/** Record a failure on the vault and DM the user once per reason per cycle. */
/** Record a failure on the vault and DM the user once per reason per cycle.
    `deferUntil` reschedules instead of disarming — see followingMonthlyWindow(). */
async function recordFailure(
    vault: VaultRow,
    merchantName: string,
    code: AutoTopUpFailureCode,
    opts: { disable?: boolean; disarm?: boolean; deferUntil?: Date } = {},
) {
    await prisma.meteredVault.update({
        where: { id: vault.id },
        data: {
            autoTopUpFailureCode: code,
            autoTopUpFailedAt: new Date(),
            ...(opts.disable ? { autoTopUpEnabled: false } : {}),
            ...(opts.disarm ? { topUpDueAt: null } : {}),
            ...(opts.deferUntil ? { topUpDueAt: opts.deferUntil } : {}),
        },
    }).catch((err) => console.error(`[vault-topup] could not persist failure for ${vault.id}:`, err));

    const { title, description } = failureMessage(code, merchantName);
    /* One message per reason per cycle, not one per 15-minute sweep. Anchored on cycleStart so a
       new cycle re-arms the warning; falls back to the spend window for an inactive vault. */
    const cycleAnchor = (vault.cycleStart ?? vault.monthlyWindowStart ?? new Date(0)).toISOString();

    await createDmAndNotify({
        senderAddress: vault.merchantAddress,
        receiverAddress: vault.userAddress,
        messageType: "AUTO_TOPUP_FAILED",
        status: "PENDING",
        title,
        description,
        dedupeKey: `auto-topup-failed:${vault.id}:${code}:${cycleAnchor}`,
    }).catch((err: any) => {
        /* P2002 = this exact warning already went out for this cycle. Anything else is worth a log
           but must not abort the sweep for the other vaults in the batch. */
        if (err?.code !== "P2002") {
            console.error(`[vault-topup] failure DM error for ${vault.id}:`, err);
        }
    });
}

async function topUpVault(vault: VaultRow, merchantName: string): Promise<{ id: string; status: string; txHash?: string; code?: string }> {
    const now = new Date();

    /* 1. Roll the spend window before comparing against the cap, and persist the reset — reading
          a stale window as zero without writing it would let the next sweep see the old total. */
    let monthlySpent = vault.monthlySpentUsdc;
    if (isMonthlyWindowStale(vault.monthlyWindowStart, now)) {
        monthlySpent = BigInt(0);
        await prisma.meteredVault.update({
            where: { id: vault.id },
            data: { monthlySpentUsdc: BigInt(0), monthlyWindowStart: nextMonthlyWindow(now) },
        });
    }

    /* 2. Re-check against the mirror. Self-heals the common benign race: the user topped up
          manually between the arming write and this sweep. Disarm and leave it alone. */
    const remaining = remainingMicros(vault.balanceUsdc, vault.accruedUsageUsdc);
    if (remaining >= vault.thresholdUsdc) {
        await prisma.meteredVault.update({
            where: { id: vault.id },
            data: { topUpDueAt: null, autoTopUpFailureCode: null, autoTopUpFailedAt: null },
        });
        return { id: vault.id, status: "no_longer_low" };
    }

    if (vault.disputed) {
        await recordFailure(vault, merchantName, "VAULT_DISPUTED", { disarm: true });
        return { id: vault.id, status: "skipped", code: "VAULT_DISPUTED" };
    }

    /* 2b. The account holder's own hold, checked here for the same reason the dispute check sits
           here: cheapest and most definitive, before any chain read. An auto top-up is a fresh pull
           out of the user's wallet against no service yet rendered, so it is exactly what a hold
           exists to stop. Nothing about the Merchant Protection carve-out applies here, because no
           merchant has delivered anything against this money.

           Left ARMED rather than disarmed or deferred, and no failure code recorded. A hold is the
           user's own reversible choice, not a broken mandate, so nothing should be written that
           looks like one. Staying armed costs one indexed read plus one hold read per sweep and
           means the refill resumes by itself the moment the hold lifts. isAccountHalted returns
           true on a read failure, so a database incident skips too. */
    if (await isAccountHalted(vault.userAddress)) {
        return { id: vault.id, status: "skipped", code: "ACCOUNT_ON_HOLD" };
    }

    const amount = vault.topUpAmountUsdc;

    /* 3. The user's own cap, checked before any chain read so an exhausted budget costs nothing.
          DEFER to next month rather than disarm: a capped vault is usually also an exhausted one,
          and an exhausted vault's usage reports take an early return that never re-arms — so
          disarming here would silence the mandate permanently the first time a cap was hit. */
    if (monthlySpent + amount > vault.monthlyLimitUsdc) {
        await recordFailure(vault, merchantName, "MONTHLY_CAP_REACHED", {
            deferUntil: followingMonthlyWindow(now),
        });
        return { id: vault.id, status: "skipped", code: "MONTHLY_CAP_REACHED" };
    }

    /* 4. Custody. An external wallet cannot be signed for, so the mandate is inert — turn it off
          rather than retrying it every sweep forever. */
    try {
        await getWalletCustody(vault.userAddress);
    } catch {
        await recordFailure(vault, merchantName, "EXTERNAL_WALLET", { disable: true, disarm: true });
        return { id: vault.id, status: "skipped", code: "EXTERNAL_WALLET" };
    }

    /* 5. The on-chain ceiling. Deliberately a READ: ensureUsdcAllowance would re-approve, which in
          an unattended job would defeat the entire point of the allowance — a user who revoked
          their approval must have that decision hold without needing to talk to us. */
    let allowance: bigint;
    let walletBalance: bigint;
    try {
        [allowance, walletBalance] = await Promise.all([
            readUsdcAllowance(vault.userAddress, SUBSCRIPT_VAULT_ADDRESS),
            readUsdcBalance(vault.userAddress),
        ]);
    } catch (err) {
        console.error(`[vault-topup] chain read failed for ${vault.id}:`, err);
        /* Leave armed and unflagged: an RPC blip is not the user's problem and must not surface
           as a funding warning. The next sweep retries. */
        return { id: vault.id, status: "deferred", code: "RPC_UNAVAILABLE" };
    }

    /* Stays ARMED, like the insufficient-funds case below: the fix is a user action (re-approve
       from the dashboard, which re-arms anyway if still low), and leaving it armed means a
       re-approval takes effect on the next sweep rather than waiting for more usage to be
       reported — which for an already-exhausted vault may never come. */
    if (allowance < amount) {
        await recordFailure(vault, merchantName, "ALLOWANCE_EXHAUSTED");
        return { id: vault.id, status: "skipped", code: "ALLOWANCE_EXHAUSTED" };
    }

    /* 6. Funds. The most common stop by far, and the one the user can act on. Stay armed so it
          fires as soon as they add funds. */
    if (walletBalance < amount) {
        await recordFailure(vault, merchantName, "INSUFFICIENT_WALLET_BALANCE");
        return { id: vault.id, status: "skipped", code: "INSUFFICIENT_WALLET_BALANCE" };
    }

    /* 7. Best-effort, matching every other unattended job: a sponsorship shortfall must not block
          a user who can pay their own gas. requireSponsoredGas is for user-initiated routes. */
    const armedAt = (vault.topUpDueAt ?? now).toISOString();
    const requestId = `auto-topup:${vault.id}:${armedAt}`;
    await ensureSponsoredGas({
        wallet: vault.userAddress,
        action: "vault_auto_topup",
        requestKey: requestId,
    }).catch((err) => console.error(`[vault-topup] sponsorship error for ${vault.id}:`, err));

    /* 8. Durable intent, reusing the manual-commit ledger. The id is derived from the ARMING
          instant, so every retry of this same low-balance event reuses one Circle idempotency key
          while a genuinely new event gets a fresh one — exactly the per-attempt requirement
          documented above commitFromEmbedded in src/lib/vault/onchain.ts. */
    const custodyIdempotencyKey = deterministicIdempotencyKey(
        `req:${requestId}:vault-auto-topup:${vault.userAddress}:${vault.merchantAddress}:${amount.toString()}`);

    try {
        await prisma.vaultCommitIntent.create({
            data: {
                requestId,
                userAddress: vault.userAddress,
                merchantAddress: vault.merchantAddress,
                amountUsdc: amount.toString(),
                environment: vault.environment,
                custodyIdempotencyKey,
                sponsorRequestKey: requestId,
            },
        });
    } catch (err: any) {
        if (err?.code !== "P2002") throw err;
        const existing = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
        if (existing?.status === "MIRRORED" && existing.txHash) {
            /* A previous sweep completed this exact top-up but died before disarming. */
            await prisma.meteredVault.update({
                where: { id: vault.id },
                data: { topUpDueAt: null },
            });
            return { id: vault.id, status: "already_completed", txHash: existing.txHash };
        }
        /* PENDING/SUBMITTED: fall through and resubmit under the SAME key — Circle dedupes. */
    }

    let txHash: string;
    try {
        txHash = await commitFromEmbedded(
            vault.userAddress,
            vault.merchantAddress,
            amount,
            custodyIdempotencyKey,
        );
    } catch (commitError: any) {
        /* AMBIGUOUS: Circle may have accepted it. Keep the intent open and stay armed so the next
           sweep retries with the same key rather than starting a second commit. */
        await prisma.vaultCommitIntent.update({
            where: { requestId },
            data: { lastError: String(commitError?.message || commitError).slice(0, 500) },
        }).catch(() => {});
        await recordFailure(vault, merchantName, "COMMIT_FAILED");
        return { id: vault.id, status: "failed", code: "COMMIT_FAILED" };
    }

    /* Finality first: everything below can fail without losing the fact that money moved. */
    await prisma.vaultCommitIntent.update({
        where: { requestId },
        data: { status: "SUBMITTED", txHash: txHash.toLowerCase(), lastError: null },
    }).catch((err) => console.error(`[vault-topup] CRITICAL: submitted top-up not recorded for ${vault.id}:`, err));

    let synced;
    try {
        synced = await syncVaultMirror(vault.userAddress, vault.merchantAddress);
        await prisma.vaultCommitIntent.update({
            where: { requestId },
            data: { status: "MIRRORED" },
        }).catch(() => {});
    } catch (syncError) {
        console.error(`[vault-topup] mirror sync failed after successful commit for ${vault.id}:`, syncError);
    }

    /* Count the spend against the cap regardless of whether the mirror synced — the money left the
       wallet, so the budget must reflect it even if our view of the balance is stale. */
    await prisma.meteredVault.update({
        where: { id: vault.id },
        data: {
            monthlySpentUsdc: { increment: amount },
            lastTopUpAt: new Date(),
            topUpDueAt: null,
            autoTopUpFailureCode: null,
            autoTopUpFailedAt: null,
            usageNotifiedBps: 0,
        },
    });

    if (synced?.active) {
        await prisma.subscriptDm.updateMany({
            where: {
                senderAddress: vault.merchantAddress,
                receiverAddress: vault.userAddress,
                messageType: { in: ["COMMIT_EXHAUSTED", "SERVICE_PAUSED", "AUTO_TOPUP_FAILED"] },
                status: "PENDING",
            },
            data: { status: "DISMISSED" },
        }).catch(() => {});
    }

    const amountLabel = (Number(amount) / 1_000_000).toFixed(2);
    /* Money left the wallet while the user was away — they get a record of it, always. */
    await createDmAndNotify({
        senderAddress: vault.merchantAddress,
        receiverAddress: vault.userAddress,
        messageType: "AUTO_TOPUP_SUCCESS",
        status: "PENDING",
        title: "Auto top-up complete",
        description: `Your committed balance with ${merchantName} was running low, so we topped it up by ${amountLabel} USDC as you set up. Your service keeps running.`,
        amountUsdc: amount,
        txHash: txHash.toLowerCase(),
        dedupeKey: `auto-topup:${vault.id}:${txHash.toLowerCase()}`,
    }).catch((err: any) => {
        if (err?.code !== "P2002") console.error(`[vault-topup] receipt DM error for ${vault.id}:`, err);
    });

    await recordMerchantEvent({
        merchantAddress: vault.merchantAddress,
        environment: vault.environment as "TEST" | "LIVE",
        eventType: "vault.topped_up",
        resourceType: "vault",
        resourceId: vault.id,
        resourceVersion: 1,
        data: {
            user_address: vault.userAddress,
            merchant_address: vault.merchantAddress,
            amount_usdc_micros: amount.toString(),
            vault_balance_usdc_micros: synced?.balance?.toString() ?? "unknown",
            tx_hash: txHash,
            active: synced?.active ?? null,
            trigger: "auto_topup",
        },
        correlationId: requestId,
        transitionKey: `vault_auto_topup:${txHash.toLowerCase()}`,
    }).catch((err) => console.error(`[vault-topup] webhook dispatch error for ${vault.id}:`, err));

    return { id: vault.id, status: "topped_up", txHash };
}

async function runVaultTopUp(request: Request) {
    try {
        if (!process.env.CRON_SECRET && !process.env.KEEPER_SECRET) {
            return NextResponse.json({ error: "Cron or keeper secret not configured" }, { status: 500 });
        }
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return await withPgClient(async (client) => {
            const lock = await client.query(
                "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
                ["subscript-vault-topup"],
            );
            if (!lock.rows[0]?.acquired) {
                return NextResponse.json({ success: true, skipped: "Vault top-up already running" }, { status: 200 });
            }

            try {
                const now = new Date();
                const dueWhere = {
                    autoTopUpEnabled: true,
                    /* NOT NULL is "armed"; lte(now) lets a row be DEFERRED into the future
                       (see the monthly-cap branch) instead of being disarmed outright. */
                    topUpDueAt: { not: null, lte: now },
                    disputed: false,
                    cancelRequestedAt: null,
                    settlementChainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID),
                } as const;

                /* Oldest arming first: a vault that has been low longest is closest to having its
                   service paused, so it must never be starved by newer arrivals. */
                const due = await prisma.meteredVault.findMany({
                    where: dueWhere,
                    orderBy: { topUpDueAt: "asc" },
                    take: BATCH_LIMIT,
                });

                const totalDue = await prisma.meteredVault.count({ where: dueWhere });
                console.log(`[metric] vault_topup_backlog: ${totalDue}, batch: ${due.length}`);
                if (totalDue > due.length) {
                    console.error(`[ALERT] vault-topup: backlog of ${totalDue - due.length} armed vaults beyond this batch`);
                }

                if (due.length === 0) {
                    return NextResponse.json({ success: true, toppedUp: 0, backlog: 0, vaults: [] }, { status: 200 });
                }

                const results: Array<{ id: string; status: string; txHash?: string; code?: string }> = [];

                /* Resolve display names once for the batch. The DMs below are the user's only
                   record of an unattended debit, so they must name the merchant the user knows,
                   not a raw address. */
                const merchantAddresses = Array.from(new Set(due.map((v) => v.merchantAddress.toLowerCase())));
                const aliases = await prisma.addressAlias.findMany({
                    where: { address: { in: merchantAddresses } },
                });
                const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

                for (const row of due) {
                    const merchantName = merchantDisplayName(aliasMap.get(row.merchantAddress.toLowerCase()));
                    try {
                        results.push(await topUpVault(row, merchantName));
                    } catch (err: any) {
                        /* One vault's unexpected failure must not strand the rest of the batch. */
                        console.error(`[vault-topup] unhandled error for vault ${row.id}:`, err);
                        results.push({ id: row.id, status: "error", code: String(err?.message || err).slice(0, 200) });
                    }
                }

                return NextResponse.json({
                    success: true,
                    toppedUp: results.filter((r) => r.status === "topped_up").length,
                    skipped: results.filter((r) => r.status === "skipped").length,
                    noLongerLow: results.filter((r) => r.status === "no_longer_low").length,
                    failed: results.filter((r) => r.status === "failed" || r.status === "error").length,
                    backlog: Math.max(0, totalDue - due.length),
                    vaults: results,
                }, { status: 200 });
            } finally {
                await client.query(
                    "select pg_advisory_unlock(hashtextextended($1, 0))",
                    ["subscript-vault-topup"],
                );
            }
        });
    } catch (error: any) {
        console.error("Vault top-up keeper error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export const GET = runVaultTopUp;
export const POST = runVaultTopUp;
