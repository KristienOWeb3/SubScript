import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Give a wallet a default anonymous username at onboarding. This prevents email metadata leaks
 * and squandering of .sub domains on abandoned accounts.
 */
export async function ensureDefaultAliasFromEmail(
    walletAddress: string,
    email: string | null | undefined
): Promise<void> {
    try {
        const address = walletAddress.toLowerCase();

        const existing = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
        if (existing) return; // already has a username — don't override

        const anonymousAlias = `anonymous-${crypto.randomUUID()}`;

        try {
            await prisma.addressAlias.create({ data: { address, alias: anonymousAlias, isAnonymous: true } });
            return;
        } catch {
            /* A concurrent signup may have claimed this alias or assigned this address.
               Stop only if this wallet now has an alias. */
            const assigned = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
            if (assigned) return;
        }
    } catch (err) {
        console.error("ensureDefaultAliasFromEmail failed:", err instanceof Error ? err.message : err);
    }
}
