/* Keeper job: at the end of each 30-day cycle, draw the accrued usage cost from each
   due vault on-chain (drawUsageFor), reset the accrued counter, and re-sync the mirror.
   Auth: Bearer KEEPER_SECRET. Signs with KEEPER_PRIVATE_KEY (the authorized drawer). */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getKeeperSigner, syncVaultMirror, VAULT_ABI } from "@/lib/vault/onchain";
import { SUBSCRIPT_VAULT_ADDRESS } from "@/lib/contracts/constants";
import { withPgClient } from "@/lib/serverPg";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import crypto from "crypto";

export const maxDuration = 300;

/* Minimum vault age before the keeper draws. 30 days in production; override with
   VAULT_DRAW_MIN_AGE_SECONDS (e.g. 60) on testnet to exercise the draw quickly.
   NOTE: the contract independently gates drawUsageFor on `lockedUntil` (= commit time +
   cycleLength). Lowering this env var alone does NOT shorten that lock — to exercise draws
   quickly on testnet you must also lower the contract's cycleLength via setCycleLength BEFORE
   the commit. The query below additionally filters on the mirrored lockedUntil so the keeper
   never submits a draw the contract would revert as "cycle not mature". */
const CYCLE_SECONDS = Number(process.env.VAULT_DRAW_MIN_AGE_SECONDS) || 30 * 24 * 60 * 60;

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

async function runVaultDraw(request: Request) {
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
                ["subscript-vault-draw"],
            );
            if (!lock.rows[0]?.acquired) {
                return NextResponse.json({ success: true, skipped: "Vault draw already running" }, { status: 200 });
            }

            try {
                const now = new Date();
                const cutoff = new Date(Date.now() - CYCLE_SECONDS * 1000);
                const dueWhere = {
                    cycleStart: { not: null, lte: cutoff },
                    /* The contract reverts drawUsageFor until block.timestamp >= lockedUntil,
                       so only attempt vaults whose lock has already elapsed. */
                    lockedUntil: { not: null, lte: now },
                    active: true,
                } as const;
                /* Oldest lock first: the contract's user reclaim opens at lockedUntil + 7 days,
                   so the vault closest to losing its settle window is always drawn first. A
                   daily run must never let a matured vault age past that window because newer
                   vaults happened to sort ahead of it. */
                const due = await prisma.meteredVault.findMany({
                    where: dueWhere,
                    orderBy: { lockedUntil: "asc" },
                    take: 200,
                });

                /* Backlog observability: how much matured work exists beyond this batch, and how
                   close the oldest pending vault is to its reclaim deadline. */
                const totalDue = await prisma.meteredVault.count({ where: dueWhere });
                const oldest = due[0]?.lockedUntil ?? null;
                const oldestPendingAgeSeconds = oldest ? Math.floor((now.getTime() - oldest.getTime()) / 1000) : 0;
                console.log(`[metric] vault_draw_backlog: ${totalDue}, batch: ${due.length}, oldest_pending_age_seconds: ${oldestPendingAgeSeconds}`);
                const RECLAIM_GRACE_SECONDS = 7 * 24 * 60 * 60;
                if (oldestPendingAgeSeconds > RECLAIM_GRACE_SECONDS - 2 * 24 * 60 * 60) {
                    console.error(`[ALERT] vault-draw: oldest matured vault is within 2 days of its user-reclaim deadline (age ${oldestPendingAgeSeconds}s)`);
                }
                if (totalDue > due.length) {
                    console.error(`[ALERT] vault-draw: backlog of ${totalDue - due.length} matured vaults beyond this batch — run the keeper again until drained`);
                }

                if (due.length === 0) {
                    return NextResponse.json({ success: true, drawn: 0, backlog: 0, vaults: [] }, { status: 200 });
                }

                const signer = getKeeperSigner();
                const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);

                const results: Array<{
                    id: string;
                    txHash?: string;
                    error?: string;
                    warning?: string;
                    reconciled?: boolean;
                }> = [];
                for (const row of due) {
                    let submittedHash: string | undefined;
                    try {
                        const tx = await vault.drawUsageFor(row.merchantAddress, row.userAddress, row.accruedUsageUsdc);
                        const receipt = await tx.wait();
                        submittedHash = receipt?.hash || tx.hash;
                    } catch (err: any) {
                        console.error(`[vault-draw] failed for vault ${row.id}:`, err);
                        /* A previous invocation may have mined the draw but died before
                           updating the mirror. Re-read chain state before treating this
                           as a fresh failure; sync also resets cycle-local accrual. */
                        try {
                            const state = await syncVaultMirror(row.userAddress, row.merchantAddress);
                            const mirroredCycle = row.cycleStart
                                ? BigInt(Math.floor(row.cycleStart.getTime() / 1000))
                                : BigInt(0);
                            if (state.cycleStart !== mirroredCycle || !state.active) {
                                results.push({ id: row.id, reconciled: true, warning: "Recovered an already-settled vault draw" });
                                continue;
                            }
                        } catch (syncError) {
                            console.error(`[vault-draw] recovery sync failed for vault ${row.id}:`, syncError);
                        }
                        results.push({ id: row.id, error: err.message || "draw failed" });
                        continue;
                    }

                    try {
                        await syncVaultMirror(row.userAddress, row.merchantAddress);
                        await recordMerchantEvent({
                            merchantAddress: row.merchantAddress,
                            environment: "TEST",
                            eventType: "vault.settled",
                            resourceType: "vault",
                            resourceId: row.id,
                            resourceVersion: 1,
                            data: {
                                user_address: row.userAddress,
                                merchant_address: row.merchantAddress,
                                amount_settled_usdc_micros: row.accruedUsageUsdc.toString(),
                                tx_hash: submittedHash,
                                vault_id: row.id,
                            },
                            correlationId: crypto.randomUUID(),
                            transitionKey: `vault_draw:${submittedHash}`,
                        }).catch(err => console.error("[vault-draw] webhook dispatch error:", err));
                        results.push({ id: row.id, txHash: submittedHash });
                    } catch (syncError: any) {
                        /* Money movement is final; never report it as an ordinary failed
                           draw that a caller might blindly repeat. Queue the mirror repair. */
                        await recordPaymentReconciliationRequired({
                            dedupeKey: `vault-draw:${submittedHash}`,
                            kind: "VAULT_DRAW_MIRROR_SYNC",
                            message: "Vault draw settled but mirror sync failed",
                            context: {
                                vaultId: row.id,
                                userAddress: row.userAddress,
                                merchantAddress: row.merchantAddress,
                                txHash: submittedHash,
                            },
                            error: syncError,
                        });
                        results.push({
                            id: row.id,
                            txHash: submittedHash,
                            warning: "Draw settled; mirror repair queued",
                        });
                    }
                }

                return NextResponse.json({
                    success: true,
                    drawn: results.filter((r) => r.txHash).length,
                    reconciled: results.filter((r) => r.reconciled).length,
                    failed: results.filter((r) => r.error).length,
                    backlog: Math.max(0, totalDue - due.length),
                    oldestPendingAgeSeconds,
                    vaults: results,
                }, { status: 200 });
            } finally {
                await client.query(
                    "select pg_advisory_unlock(hashtextextended($1, 0))",
                    ["subscript-vault-draw"],
                );
            }
        });
    } catch (error: any) {
        console.error("Vault draw keeper error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export const GET = runVaultDraw;
export const POST = runVaultDraw;
