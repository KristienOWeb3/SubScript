/* Resolving a peer's avatar means reading two tables, not one.
 *
 * /api/user/settings writes profile pictures role-scoped: merchants.profile_pic when the account
 * role is ENTERPRISE, customers.profile_pic otherwise. Every DM surface that looked only at
 * customers therefore rendered a default avatar for merchant peers, and any surface that read both
 * had to be careful not to let a NULL merchant row overwrite a live customer row.
 *
 * One resolver, so neither mistake has to be avoided by hand at each call site. */
import { prisma } from "@/lib/prisma";
import { safeProfilePicOrNull } from "@/lib/profilePicSafety";

/**
 * Map lowercased address -> avatar, for every address that has a usable one.
 *
 * Addresses with no picture are simply absent, so `map.get(addr) || null` reads naturally.
 * Values are sanitized, so legacy unsafe rows never reach the client.
 */
export async function resolveProfilePics(addresses: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).filter(Boolean);
    const resolved = new Map<string, string>();
    if (unique.length === 0) return resolved;

    const [customers, merchants] = await Promise.all([
        prisma.customer.findMany({
            where: { walletAddress: { in: unique } },
            select: { walletAddress: true, profilePic: true },
        }),
        prisma.merchant.findMany({
            where: { walletAddress: { in: unique } },
            select: { walletAddress: true, profilePic: true },
        }),
    ]);

    /* Record only what is actually there, so whichever table holds the picture wins regardless of
       which one is read second. */
    const remember = (address: string, value: string | null | undefined) => {
        const safe = safeProfilePicOrNull(value);
        if (safe) resolved.set(address.toLowerCase(), safe);
    };
    customers.forEach((c) => remember(c.walletAddress, c.profilePic));
    merchants.forEach((m) => remember(m.walletAddress, m.profilePic));

    return resolved;
}
