import { runAdminQueriesSequentially } from "@/lib/admin/db";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/admin/guard";
import { getSponsorWalletStatus } from "@/lib/sponsor/gas";
import { jsonOk } from "@/lib/http/json";

const MICRO_USDC = 1_000_000n;

function formatUsdc(micro: bigint | null | undefined): string {
  if (micro === null || micro === undefined) return "0.00";
  const negative = micro < 0n;
  const value = negative ? -micro : micro;
  const whole = value / MICRO_USDC;
  const fraction = (value % MICRO_USDC).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(String(value).split(".")[0]);
  } catch {
    return 0n;
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireScope(request, "read");
    if (!auth.ok) return auth.response;

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      sponsor,
      merchantsRaw,
      bannedAccounts,
      bannedIps,
      totalUsers,
      confirmedReceipts,
      receipts30d,
      activeSubsCount,
      kycPendingCount,
      stuckReceiptsCount,
      recentReceipts14d,
      recentUsers14d,
    ] = await runAdminQueriesSequentially([
      () => getSponsorWalletStatus(),
      () => prisma.merchant.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          walletAddress: true,
          tier: true,
          verified: true,
          profilePic: true,
          createdAt: true,
        },
      }),
      () => prisma.bannedAccount.findMany({ orderBy: { createdAt: "desc" } }),
      () => prisma.bannedIp.findMany({ orderBy: { createdAt: "desc" } }),
      () => prisma.accountRole.count(),
      () => prisma.receipt.aggregate({
        where: { status: "CONFIRMED" },
        _sum: { amountUsdc: true },
        _count: true,
      }),
      () => prisma.receipt.aggregate({
        where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
        _sum: { amountUsdc: true },
        _count: true,
      }),
      () => prisma.subscription.count({ where: { status: "ACTIVE" } }),
      () => prisma.kycVerification.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }),
      () => prisma.receipt.count({ where: { status: { not: "CONFIRMED" }, createdAt: { lt: sevenDaysAgo } } }),
      () => prisma.receipt.findMany({
        where: { status: "CONFIRMED", createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true, amountUsdc: true },
        orderBy: { createdAt: "asc" },
      }),
      () => prisma.accountRole.findMany({
        where: { createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const merchantAddresses = merchantsRaw.map((m) => m.walletAddress.toLowerCase());
    const aliases = await prisma.addressAlias.findMany({
      where: { address: { in: merchantAddresses } },
    });
    const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

    const merchants = merchantsRaw.map((m) => ({
      walletAddress: m.walletAddress,
      merchantName: aliasMap.get(m.walletAddress.toLowerCase()) || m.walletAddress.slice(0, 10),
      tier: m.tier,
      verified: m.verified,
      profilePic: m.profilePic,
      createdAt: m.createdAt,
    }));

    /* 14-day sparkline timeline */
    const timeline14d: Array<{ date: string; label: string; volume: number; users: number }> = [];
    const dayMap: Map<string, { volumeMicro: bigint; users: number }> = new Map();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, { volumeMicro: 0n, users: 0 });
    }

    for (const r of recentReceipts14d) {
      const key = r.createdAt.toISOString().slice(0, 10);
      const b = dayMap.get(key);
      if (b) b.volumeMicro += BigInt(r.amountUsdc);
    }
    for (const u of recentUsers14d) {
      const key = u.createdAt.toISOString().slice(0, 10);
      const b = dayMap.get(key);
      if (b) b.users += 1;
    }

    for (const [dateStr, val] of dayMap.entries()) {
      const d = new Date(dateStr);
      timeline14d.push({
        date: dateStr,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        volume: Number(val.volumeMicro) / 1_000_000,
        users: val.users,
      });
    }

    return jsonOk({
      success: true,
      sponsor,
      sponsorWalletAddress: sponsor.address,
      sponsorBalanceUsdc: sponsor.balanceUsdc ?? "0",
      merchants,
      bannedAccounts,
      bannedIps,
      totalUsers,
      viewerIsRoot: auth.admin.isRoot,
      viewerWallet: auth.admin.wallet,
      metrics: {
        totalVolumeUsdc: formatUsdc(toBigInt(confirmedReceipts._sum.amountUsdc)),
        totalVolumeCount: confirmedReceipts._count,
        volume30dUsdc: formatUsdc(toBigInt(receipts30d._sum.amountUsdc)),
        volume30dCount: receipts30d._count,
        activeSubsCount,
        kycPendingCount,
        stuckReceiptsCount,
        timeline14d,
      },
    });
  } catch (err: any) {
    console.error("Admin overview failed:", err);
    return NextResponse.json({ error: "Failed to load admin overview." }, { status: 500 });
  }
}
