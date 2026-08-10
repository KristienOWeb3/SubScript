import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Give a wallet a default username at onboarding derived from email prefix + ".sub"
 * (e.g. chuks@gmail.com -> chuks.sub).
 */
export async function ensureDefaultAliasFromEmail(
    walletAddress: string,
    email: string | null | undefined
): Promise<void> {
    try {
        const address = walletAddress.toLowerCase();

        const existing = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
        if (existing) return; // already has a username — don't override

        let basePrefix = "";
        if (email && email.includes("@")) {
            basePrefix = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
        }
        if (!basePrefix) {
            basePrefix = `user-${crypto.randomBytes(3).toString("hex")}`;
        }

        let desiredAlias = `${basePrefix}.sub`;
        let counter = 1;

        // Ensure uniqueness
        while (counter <= 50) {
            const taken = await prisma.addressAlias.findFirst({
                where: { alias: { equals: desiredAlias, mode: "insensitive" } }
            }).catch(() => null);

            if (!taken) break;
            desiredAlias = `${basePrefix}${counter}.sub`;
            counter++;
        }

        try {
            await prisma.addressAlias.create({
                data: {
                    address,
                    alias: desiredAlias,
                    isAnonymous: false
                }
            });
            return;
        } catch {
            const assigned = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
            if (assigned) return;
        }
    } catch (err) {
        console.error("ensureDefaultAliasFromEmail failed:", err instanceof Error ? err.message : err);
    }
}
