/* Wallets permitted to reach the admin console.
 *
 * Admin identity has TWO tiers, and the effective set is their union:
 *
 *   ROOT      — ADMIN_WALLET_ADDRESSES env var. Cannot be revoked from the console.
 *               This is the recovery path: it keeps working when the database is
 *               unreachable, when Redis is empty, and when someone makes a mistake
 *               in the Admins tab. At least one root admin must always exist.
 *
 *   DELEGATED — the admin_wallets table, granted and revoked in the console by a
 *               root admin. Mirrored to a Redis set so edge middleware can see it.
 *
 * This file is deliberately free of imports: middleware runs on the edge runtime and
 * cannot pull in `@/lib/auth` (node:crypto) or `@/lib/serverPg` (require("pg")). Root
 * membership is pure env-string parsing, so the edge gate, the /admin layout, and every
 * /api/admin handler share ONE definition of who is a root admin instead of drifting.
 * Delegated membership needs I/O and therefore lives in identity.ts (Node) and the
 * Redis mirror (edge) — never here.
 *
 * Unset means nobody, so a deploy that forgets the variable locks the console rather
 * than opening it.
 */

export function adminWalletAllowlist(): Set<string> {
    return new Set(
        (process.env.ADMIN_WALLET_ADDRESSES || process.env.ADMIN_WALLET_ADDRESS || "")
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
    );
}

/** Root admins only. Delegated admins are NOT included — see isAdminWallet() in identity.ts. */
export function isRootAdmin(address: string | null | undefined): boolean {
    if (!address) return false;
    const allowlist = adminWalletAllowlist();
    if (allowlist.size === 0) return false;
    return allowlist.has(address.trim().toLowerCase());
}
