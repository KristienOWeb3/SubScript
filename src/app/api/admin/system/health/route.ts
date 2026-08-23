import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { checkRuntimeConfig } from "@/lib/ops/configCheck";
import { executeWithRpcFallback, getRpcProviderForWrite } from "@/lib/payments/rpc";
import { getPlatformFlags } from "@/lib/platform/flags";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        /* 1. Runtime Config Diagnostics */
        const configWarnings = checkRuntimeConfig();

        /* 2. Arc RPC Latency & Block Height */
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
            const { provider: writeProvider } = await getRpcProviderForWrite();
            await writeProvider.getBlockNumber();
            rpcWriteLatencyMs = Date.now() - startWrite;
        } catch (err: any) {
            rpcError = err.message || "Failed to reach Arc RPC";
        }

        /* 3. Redis Connectivity */
        let redisStatus: "healthy" | "unconfigured" | "error" = "unconfigured";
        let redisLatencyMs: number | null = null;
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                const { Redis } = await import("@upstash/redis");
                const redis = new Redis({
                    url: process.env.UPSTASH_REDIS_REST_URL,
                    token: process.env.UPSTASH_REDIS_REST_TOKEN,
                });
                const startRedis = Date.now();
                await redis.ping();
                redisLatencyMs = Date.now() - startRedis;
                redisStatus = "healthy";
            } catch {
                redisStatus = "error";
            }
        }

        /* 4. Billing Keeper Status */
        const overdueSubscriptions = await prisma.subscription.count({
            where: {
                status: "ACTIVE",
                nextBillingDate: { lt: new Date() },
            },
        });

        /* 5. Platform Flags */
        const platformFlags = await getPlatformFlags();

        return NextResponse.json({
            success: true,
            diagnostics: {
                configWarnings,
                isHealthy: configWarnings.length === 0 && !rpcError,
            },
            rpc: {
                chainId,
                blockNumber,
                readLatencyMs: rpcReadLatencyMs,
                writeLatencyMs: rpcWriteLatencyMs,
                status: rpcError ? "degraded" : "healthy",
                error: rpcError,
            },
            redis: {
                status: redisStatus,
                latencyMs: redisLatencyMs,
            },
            keeper: {
                overdueSubscriptionsCount: overdueSubscriptions,
                status: overdueSubscriptions > 50 ? "backlogged" : "healthy",
            },
            platformFlags,
        });

    } catch (error: any) {
        console.error("[admin/system/health] error:", error);
        return NextResponse.json({ error: error.message || "Failed to check system health" }, { status: 500 });
    }
}
