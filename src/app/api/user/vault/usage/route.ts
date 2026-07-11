/* Itemized metered-usage history for the signed-in account — the transparent, DigitalOcean-style
   record of what a merchant has billed against a vault. USERS see their own charges; merchants
   (ENTERPRISE) see charges they reported. Read-only; append-only ledger. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const role = await resolveAccountRoleWithBackfill(wallet);
        if (role !== "USER" && role !== "ENTERPRISE") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const self = wallet.toLowerCase();

        const { searchParams } = new URL(request.url);
        const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);
        const beforeParam = searchParams.get("before");
        const before = beforeParam ? new Date(beforeParam) : null;
        if (before && Number.isNaN(before.getTime())) {
            return NextResponse.json({ error: "Invalid 'before' cursor" }, { status: 400 });
        }

        /* Optional counterparty filter (a specific merchant for a user, or a specific user for a
           merchant). Validated so it can't be used to read another account's ledger — the caller's
           own address is always pinned to their role side below. */
        const counterparty = searchParams.get("merchantAddress") || searchParams.get("userAddress") || "";
        if (counterparty && !ethers.isAddress(counterparty)) {
            return NextResponse.json({ error: "Invalid counterparty address" }, { status: 400 });
        }
        const normalizedCounterparty = counterparty ? counterparty.toLowerCase() : null;

        const where: Record<string, unknown> = role === "USER"
            ? { userAddress: self, ...(normalizedCounterparty ? { merchantAddress: normalizedCounterparty } : {}) }
            : { merchantAddress: self, ...(normalizedCounterparty ? { userAddress: normalizedCounterparty } : {}) };
        if (before) where.createdAt = { lt: before };

        const rows = await prisma.meteredUsageReport.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit + 1,
        });

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        return NextResponse.json({
            success: true,
            reports: page.map((r) => ({
                id: r.id,
                userAddress: r.userAddress,
                merchantAddress: r.merchantAddress,
                amountUsdc: r.amountUsdc.toString(),
                accruedAfterUsdc: r.accruedAfterUsdc.toString(),
                balanceUsdc: r.balanceUsdc.toString(),
                note: r.note,
                requestId: r.requestId,
                createdAt: r.createdAt,
            })),
            nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Usage history load failed:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
