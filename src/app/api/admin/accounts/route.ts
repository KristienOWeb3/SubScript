import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim()?.toLowerCase() || "";
    const roleFilter = url.searchParams.get("role")?.toUpperCase() || "";
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    try {
        const whereClause: any = {};
        if (search) {
            whereClause.OR = [
                { address: { contains: search, mode: "insensitive" } },
            ];
        }
        if (roleFilter && (roleFilter === "USER" || roleFilter === "ENTERPRISE")) {
            whereClause.role = roleFilter;
        }

        const roles = await prisma.accountRole.findMany({
            where: whereClause,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
                kycVerification: {
                    select: { status: true, requestedLevel: true },
                },
            },
        });

        const addresses = roles.map((r) => r.address.toLowerCase());

        // Batch fetch embedded wallet info to detect custody type
        const embeddedWallets = await prisma.userEmbeddedWallet.findMany({
            where: { walletAddress: { in: addresses } },
            select: {
                walletAddress: true,
                email: true,
                provider: true,
                circleWalletId: true,
                encryptedPrivateKey: true,
                createdAt: true,
            },
        });
        const embeddedMap = new Map(embeddedWallets.map((w) => [w.walletAddress.toLowerCase(), w]));

        // Batch fetch aliases
        const aliases = await prisma.addressAlias.findMany({
            where: { address: { in: addresses } },
            select: { address: true, alias: true },
        });
        const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

        // Batch fetch merchants
        const merchants = await prisma.merchant.findMany({
            where: { walletAddress: { in: addresses } },
            select: { walletAddress: true, tier: true, verified: true, availableBalanceUsdc: true },
        });
        const merchantMap = new Map(merchants.map((m) => [m.walletAddress.toLowerCase(), m]));

        const accounts = roles.map((r) => {
            const addr = r.address.toLowerCase();
            const emb = embeddedMap.get(addr);
            const alias = aliasMap.get(addr) || null;
            const merch = merchantMap.get(addr);

            let custodyType = "External (Browser)";
            if (emb) {
                if (emb.circleWalletId) {
                    custodyType = "Circle MPC";
                } else if (emb.encryptedPrivateKey) {
                    custodyType = "Legacy Encrypted EOA";
                }
            }

            return {
                address: addr,
                role: r.role,
                alias,
                email: emb?.email || null,
                custodyType,
                merchantTier: merch?.tier || null,
                merchantVerified: merch?.verified || false,
                kycStatus: r.kycVerification?.status || "UNVERIFIED",
                createdAt: r.createdAt,
            };
        });

        return NextResponse.json({
            success: true,
            accounts,
            total: accounts.length,
        });

    } catch (error: any) {
        console.error("[admin/accounts] error:", error);
        return NextResponse.json({ error: error.message || "Failed to list accounts" }, { status: 500 });
    }
}
