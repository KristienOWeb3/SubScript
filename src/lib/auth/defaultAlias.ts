import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/* Must match USER_ALIAS_REGEX in /api/merchant/alias: 3-15 chars of [a-z0-9-] before ".sub".
   A default that fails this check would be unusable *and* would cost the user their one free
   rename (the 365-day cooldown) just to fix a name they never picked. */
const ALIAS_LABEL_MIN = 3;
const ALIAS_LABEL_MAX = 15;

/**
 * Derive the alias label from an email local part, e.g. "Chuks.O+billing@gmail.com" -> "chuks-o".
 * Returns null when nothing usable survives sanitising, so the caller can fall back.
 */
function labelFromEmail(email: string | null | undefined): string | null {
    if (!email || !email.includes("@")) return null;

    let label = email
        .split("@")[0]
        .toLowerCase()
        /* "+" tags are not part of the identity, and everything after it is usually noise. */
        .split("+")[0]
        /* Dots/underscores are the common word separators in emails; "-" is the only
           separator the alias regex allows, so fold them all into it. */
        .replace(/[._]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        /* Leading/trailing/repeated dashes read as typos in a public @name. */
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");

    if (!label) return null;
    if (label.length > ALIAS_LABEL_MAX) {
        label = label.slice(0, ALIAS_LABEL_MAX).replace(/-+$/, "");
    }
    /* Too short to be legal — pad rather than discard, so "jo@x.com" still reads as "jo".
       Random hex keeps distinct short locals from all colliding on the same candidate. */
    if (label.length < ALIAS_LABEL_MIN) {
        const pad = crypto.randomBytes(2).toString("hex");
        label = `${label}-${pad}`.slice(0, ALIAS_LABEL_MAX).replace(/-+$/, "");
    }

    return label.length >= ALIAS_LABEL_MIN ? label : null;
}

/**
 * Build the candidate list to try in order: the plain label first, then numeric suffixes.
 * Suffixes are trimmed from the label so the result never exceeds the 15-char limit.
 */
function candidatesFor(label: string): string[] {
    const out = [`${label}.sub`];
    for (let n = 1; n <= 20; n++) {
        const suffix = String(n);
        const base = label.slice(0, ALIAS_LABEL_MAX - suffix.length).replace(/-+$/, "");
        if (base.length >= 1) out.push(`${base}${suffix}.sub`);
    }
    return out;
}

/**
 * Give a wallet a default username at onboarding, derived from the email local part
 * (chuks@gmail.com -> chuks.sub). Falls back to a random user-xxxxxx.sub name when no
 * usable email is available, so no account is ever left displaying a raw UUID.
 *
 * Never overrides an existing alias.
 */
export async function ensureDefaultAliasFromEmail(
    walletAddress: string,
    email: string | null | undefined
): Promise<void> {
    try {
        const address = walletAddress.toLowerCase();

        const existing = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
        if (existing) return; // already has a username — don't override

        const label = labelFromEmail(email);
        const candidates = label
            ? candidatesFor(label)
            : [`user-${crypto.randomBytes(3).toString("hex")}.sub`];

        for (const candidate of candidates) {
            /* Case-insensitive: the column is stored lowercase, but a pre-existing row from an
               older code path could differ in case and would still collide on the unique index. */
            const taken = await prisma.addressAlias.findFirst({
                where: { alias: { equals: candidate, mode: "insensitive" } },
                select: { address: true },
            }).catch(() => null);
            if (taken) continue;

            try {
                await prisma.addressAlias.create({
                    data: { address, alias: candidate, isAnonymous: false },
                });
                return;
            } catch {
                /* A concurrent signup may have claimed this alias or assigned this address.
                   Stop only if this wallet now has an alias; otherwise try the next candidate. */
                const assigned = await prisma.addressAlias.findUnique({ where: { address } }).catch(() => null);
                if (assigned) return;
            }
        }

        /* Every candidate was contended. Fall back to a name that cannot realistically collide
           rather than leaving the wallet with no alias at all. */
        try {
            await prisma.addressAlias.create({
                data: {
                    address,
                    alias: `user-${crypto.randomBytes(3).toString("hex")}.sub`,
                    isAnonymous: false,
                },
            });
        } catch {
            /* Losing this race means the wallet already has an alias — nothing left to do. */
        }
    } catch (err) {
        console.error("ensureDefaultAliasFromEmail failed:", err instanceof Error ? err.message : err);
    }
}
