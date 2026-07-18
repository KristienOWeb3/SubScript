import { prisma } from "@/lib/prisma";

/* A user's username/DNS is a ".sub" alias: 3-15 chars of [a-z0-9-]. */
const USER_ALIAS_RE = /^[a-z0-9-]{3,15}\.sub$/;

/** Derive an alias base (the part before ".sub") from an email local-part. */
function baseFromEmail(email: string): string | null {
    const local = (email.split("@")[0] || "").toLowerCase();
    let base = local.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    if (base.length < 3) base = `${base}user`; // pad very short locals (e.g. "jo" -> "jouser")
    base = base.slice(0, 15).replace(/-+$/g, "");
    return base.length >= 3 ? base : null;
}

/**
 * Give a wallet a default ".sub" username derived from its email — used at onboarding so the
 * name is the email username (without the domain). Only applies if the wallet has no alias yet
 * (never overrides a chosen username), and it's changeable later. Best-effort: never throws.
 */
export async function ensureDefaultAliasFromEmail(
    walletAddress: string,
    email: string | null | undefined
): Promise<void> {
    try {
        if (!email) return;
        const address = walletAddress.toLowerCase();

        const existing = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
        if (existing) return; // already has a username — don't override

        const base = baseFromEmail(email);
        if (!base) return;

        /* Find the first free alias: base.sub, base1.sub, base2.sub, … */
        for (let i = 0; i < 50; i++) {
            const suffix = i === 0 ? "" : String(i);
            const candidate = `${base.slice(0, 15 - suffix.length).replace(/-+$/g, "")}${suffix}`;
            const alias = `${candidate}.sub`;
            if (!USER_ALIAS_RE.test(alias)) continue;
            const taken = await prisma.addressAlias.findUnique({ where: { alias } }).catch(() => null);
            if (taken) continue;
            // create() (not upsert) so a concurrent assignment can't clobber an existing username
            try {
                await prisma.addressAlias.create({ data: { address, alias, isAnonymous: false } });
                return;
            } catch {
                /* A concurrent signup may have claimed this alias or assigned this address.
                   Stop only if this wallet now has an alias; otherwise probe the next suffix. */
                const assigned = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
                if (assigned) return;
            }
        }
    } catch (err) {
        console.error("ensureDefaultAliasFromEmail failed:", err instanceof Error ? err.message : err);
    }
}
