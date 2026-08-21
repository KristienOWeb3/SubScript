/*
 * Who to email when something happens that platform admins need to know about.
 *
 * This was duplicated inline in api/admin/flags and api/support/tickets, and both copies
 * read `ADMIN_ROOT_WALLET` — an env var that exists nowhere in this repo and isn't in
 * .env.example. The canonical variable is ADMIN_WALLET_ADDRESSES, parsed by
 * lib/admin/allowlist. So root admins were being dropped from every admin alert: the
 * delegated wallets in admin_wallets got mail, the un-revokable root tier didn't.
 * Resolving the audience through listRootAdmins() fixes that for every caller at once.
 *
 * Effective audience = ROOT (env) ∪ DELEGATED (admin_wallets), mapped to whatever email
 * each wallet has on its auth identity. A wallet with no verified email is simply skipped.
 */

import { prisma } from "@/lib/prisma";
import { listRootAdmins } from "@/lib/admin/identity";

/**
 * Every distinct address to notify for a platform-level event.
 *
 * Never throws: an alert is a side effect of an action that already succeeded, so a
 * failed lookup returns an empty list and logs rather than turning a completed grant or
 * a filed ticket into a 500.
 */
export async function listAdminNotificationEmails(): Promise<string[]> {
    const wallets = new Set<string>();

    /* Root first, and outside the try: it's pure env parsing, so it still resolves when
       Postgres is unreachable — the same degradation posture as isAdminWallet(). */
    for (const wallet of listRootAdmins()) {
        if (wallet) wallets.add(wallet.toLowerCase());
    }

    try {
        const delegated = await prisma.adminWallet.findMany({ select: { wallet: true } });
        delegated.forEach((row) => wallets.add(row.wallet.toLowerCase()));
    } catch (error) {
        console.error("[admin-recipients] delegated admin lookup failed, root admins only:", error);
    }

    if (wallets.size === 0) return [];

    try {
        const identities = await prisma.authIdentity.findMany({
            where: { walletAddress: { in: Array.from(wallets) } },
            select: { currentEmail: true },
        });
        const emails = new Set<string>();
        identities.forEach((identity) => {
            if (identity.currentEmail) emails.add(identity.currentEmail.toLowerCase());
        });
        return Array.from(emails);
    } catch (error) {
        console.error("[admin-recipients] admin email lookup failed:", error);
        return [];
    }
}
