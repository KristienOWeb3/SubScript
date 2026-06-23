/* Keeper job: at the end of each 30-day cycle, draw the accrued usage cost from each
   due vault on-chain (drawUsageFor), reset the accrued counter, and re-sync the mirror.
   Auth: Bearer KEEPER_SECRET. Signs with KEEPER_PRIVATE_KEY (the authorized drawer). */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getKeeperSigner, syncVaultMirror, VAULT_ABI } from "@/lib/vault/onchain";
import { SUBSCRIPT_VAULT_ADDRESS } from "@/lib/contracts/constants";

export const maxDuration = 300;

/* Minimum vault age before the keeper draws. 30 days in production; override with
   VAULT_DRAW_MIN_AGE_SECONDS (e.g. 60) on testnet to exercise the draw quickly. */
const CYCLE_SECONDS = Number(process.env.VAULT_DRAW_MIN_AGE_SECONDS) || 30 * 24 * 60 * 60;

export async function POST(request: Request) {
    try {
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Keeper secret not configured" }, { status: 500 });
        }
        if (request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const cutoff = new Date(Date.now() - CYCLE_SECONDS * 1000);
        const due = await prisma.meteredVault.findMany({
            where: {
                accruedUsageUsdc: { gt: BigInt(0) },
                cycleStart: { not: null, lte: cutoff },
            },
            take: 200,
        });

        if (due.length === 0) {
            return NextResponse.json({ success: true, drawn: 0, vaults: [] }, { status: 200 });
        }

        const signer = getKeeperSigner();
        const vault = new ethers.Contract(SUBSCRIPT_VAULT_ADDRESS, VAULT_ABI, signer);

        const results: Array<{ id: string; txHash?: string; error?: string }> = [];
        for (const row of due) {
            try {
                const tx = await vault.drawUsageFor(row.merchantAddress, row.userAddress, row.accruedUsageUsdc);
                const receipt = await tx.wait();
                await prisma.meteredVault.update({
                    where: { id: row.id },
                    data: { accruedUsageUsdc: BigInt(0) },
                });
                await syncVaultMirror(row.userAddress, row.merchantAddress);
                results.push({ id: row.id, txHash: receipt?.hash || tx.hash });
            } catch (err: any) {
                console.error(`[vault-draw] failed for vault ${row.id}:`, err);
                results.push({ id: row.id, error: err.message || "draw failed" });
            }
        }

        return NextResponse.json({
            success: true,
            drawn: results.filter((r) => r.txHash).length,
            failed: results.filter((r) => r.error).length,
            vaults: results,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault draw keeper error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
