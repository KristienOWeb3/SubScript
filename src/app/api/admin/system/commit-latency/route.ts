import { NextResponse } from "next/server";
import { requireAnyScope } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { executeWithRpcFallback, getRpcProviderForWrite } from "@/lib/payments/rpc";
import { calculateLatencyStats, getLatencyHealthTier } from "@/lib/admin/commitLatency";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAnyScope(request, ["engineering", "read"]);
  if (!auth.ok) return auth.response;

  try {
    /* 1. Database Transaction & Read Commit Latency */
    let dbReadLatencyMs: number | null = null;
    let dbCommitLatencyMs: number | null = null;
    let dbError: string | null = null;

    try {
      const readStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbReadLatencyMs = Date.now() - readStart;

      const commitStart = Date.now();
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
      });
      dbCommitLatencyMs = Date.now() - commitStart;
    } catch (err: any) {
      dbError = err?.message || "Failed to query database";
    }

    /* 2. Arc RPC Read & Block Write Latency */
    let rpcReadLatencyMs: number | null = null;
    let rpcWriteLatencyMs: number | null = null;
    let blockNumber: number | null = null;
    let chainId: number | null = null;
    let rpcError: string | null = null;

    try {
      const startRead = Date.now();
      const { result: readInfo } = await executeWithRpcFallback(async (provider) => {
        const [block, network] = await Promise.all([
          provider.getBlockNumber(),
          provider.getNetwork(),
        ]);
        return { block, chainId: Number(network.chainId) };
      });
      rpcReadLatencyMs = Date.now() - startRead;
      blockNumber = readInfo.block;
      chainId = readInfo.chainId;

      const startWrite = Date.now();
      await getRpcProviderForWrite();
      rpcWriteLatencyMs = Date.now() - startWrite;
    } catch (err: any) {
      rpcError = err?.message || "Failed to reach Arc RPC";
    }

    /* 3. SubScript Protocol Vault Commit Latency Sample */
    let recentIntents: any[] = [];
    try {
      recentIntents = await prisma.vaultCommitIntent.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          requestId: true,
          userAddress: true,
          merchantAddress: true,
          amountUsdc: true,
          status: true,
          txHash: true,
          createdAt: true,
          updatedAt: true,
          lastError: true,
        },
      });
    } catch (intentErr: any) {
      console.error("[admin/system/commit-latency] intent query error:", intentErr);
    }

    const vaultStats = calculateLatencyStats(recentIntents);

    const formattedIntents = recentIntents.map((intent) => {
      const created = new Date(intent.createdAt).getTime();
      const updated = new Date(intent.updatedAt).getTime();
      const durationMs =
        !isNaN(created) && !isNaN(updated) && updated >= created
          ? updated - created
          : null;

      return {
        requestId: intent.requestId,
        userAddress: intent.userAddress,
        merchantAddress: intent.merchantAddress,
        amountUsdc: intent.amountUsdc?.toString() || "0",
        status: intent.status,
        txHash: intent.txHash,
        durationMs,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
        lastError: intent.lastError,
      };
    });

    /* Overall Health Verdict */
    let overallVerdict: "optimal" | "acceptable" | "degraded" | "unmeasured" = "optimal";
    if (dbError || rpcError) {
      overallVerdict = "degraded";
    } else if (vaultStats.sampleCount === 0 && dbCommitLatencyMs === null) {
      overallVerdict = "unmeasured";
    } else if (
      (vaultStats.averageMs !== null && vaultStats.averageMs >= 6000) ||
      (dbCommitLatencyMs !== null && dbCommitLatencyMs >= 200) ||
      (rpcWriteLatencyMs !== null && rpcWriteLatencyMs >= 5000)
    ) {
      overallVerdict = "degraded";
    } else if (
      (vaultStats.averageMs !== null && vaultStats.averageMs >= 3500) ||
      (dbCommitLatencyMs !== null && dbCommitLatencyMs >= 50) ||
      (rpcWriteLatencyMs !== null && rpcWriteLatencyMs >= 2500)
    ) {
      overallVerdict = "acceptable";
    }

    return NextResponse.json({
      success: true,
      measuredAt: new Date().toISOString(),
      verdict: overallVerdict,
      database: {
        readLatencyMs: dbReadLatencyMs,
        commitLatencyMs: dbCommitLatencyMs,
        status: dbError ? "error" : getLatencyHealthTier(dbCommitLatencyMs),
        error: dbError,
      },
      rpc: {
        chainId,
        blockNumber,
        readLatencyMs: rpcReadLatencyMs,
        writeLatencyMs: rpcWriteLatencyMs,
        status: rpcError ? "error" : getLatencyHealthTier(rpcWriteLatencyMs),
        error: rpcError,
      },
      vaultCommits: {
        stats: vaultStats,
        status: getLatencyHealthTier(vaultStats.averageMs),
        recent: formattedIntents,
      },
    });
  } catch (error: any) {
    console.error("[admin/system/commit-latency] unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to inspect commit latency" },
      { status: 500 }
    );
  }
}
