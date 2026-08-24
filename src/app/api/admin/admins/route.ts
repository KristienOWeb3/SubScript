import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireRootAdmin } from "@/lib/admin/guard";
import { listDelegatedAdmins, listRootAdmins, mirrorDelegatedAdmins } from "@/lib/admin/identity";
import { recordAdminAction } from "@/lib/admin/audit";

/* Admin access management.
 *
 * GET is readable by any admin (delegated admins should be able to see who else has
 * access — concealing that from a colleague buys nothing). POST/DELETE are root-only:
 * see requireRootAdmin in @/lib/admin/guard for why the grant power stays in env.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const [delegated, root] = [await listDelegatedAdmins(), listRootAdmins()];
        const allWallets = [...root, ...delegated.map((d) => d.wallet.toLowerCase())];
        const aliases = await prisma.addressAlias.findMany({
            where: { address: { in: allWallets } },
            select: { address: true, alias: true },
        });
        const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

        const formatAdminHandle = (wallet: string, label?: string | null, isRoot?: boolean) => {
            if (label && label.trim()) {
                const clean = label.trim().replace(/^@/, "").replace(/\.admin$/i, "");
                return `${clean.charAt(0).toUpperCase() + clean.slice(1)}.admin`;
            }
            const alias = aliasMap.get(wallet.toLowerCase());
            if (alias && alias.trim()) {
                const clean = alias.trim().replace(/^@/, "").replace(/\.admin$/i, "");
                return `${clean.charAt(0).toUpperCase() + clean.slice(1)}.admin`;
            }
            if (isRoot) return "Chuks.admin";
            const short = wallet.slice(2, 6).toUpperCase();
            return `Admin${short}.admin`;
        };

        return NextResponse.json({
            /* Root wallets are reported so the console can render them as
               non-revocable rather than pretending they do not exist. */
            root: root.map((wallet) => ({
                wallet,
                tier: "root" as const,
                adminHandle: formatAdminHandle(wallet, null, true),
                alias: aliasMap.get(wallet.toLowerCase()) || null,
            })),
            delegated: delegated.map((entry) => ({
                wallet: entry.wallet,
                label: entry.label,
                grantedBy: entry.grantedBy,
                createdAt: entry.createdAt.toISOString(),
                tier: "delegated" as const,
                adminHandle: formatAdminHandle(entry.wallet, entry.label, false),
                alias: aliasMap.get(entry.wallet.toLowerCase()) || null,
            })),
            viewerIsRoot: auth.admin.isRoot,
        });
    } catch (error) {
        console.error("[admin/admins] list failed:", error);
        return NextResponse.json({ error: "Failed to load admins" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireRootAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const rawWallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
        const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) : null;

        if (!ADDRESS_PATTERN.test(rawWallet)) {
            return NextResponse.json(
                { error: "Enter a valid wallet address (0x followed by 40 hex characters)." },
                { status: 400 },
            );
        }
        const wallet = rawWallet.toLowerCase();

        /* Granting a wallet that is already root is a no-op that would look like it
           worked and then appear un-revocable in the UI. Say so instead. */
        if (listRootAdmins().includes(wallet)) {
            return NextResponse.json(
                { error: "That wallet is already a root admin via ADMIN_WALLET_ADDRESSES." },
                { status: 409 },
            );
        }

        await prisma.adminWallet.upsert({
            where: { wallet },
            update: { label: label || undefined },
            create: { wallet, label: label || null, grantedBy: auth.admin.wallet },
        });

        const mirror = await mirrorDelegatedAdmins();
        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_WALLET_GRANT",
            target: wallet,
            detail: { label, mirrored: mirror.mirrored },
            request,
        });

        return NextResponse.json({
            success: true,
            wallet,
            /* Surface a failed mirror instead of swallowing it: the grant is committed and
               correct, but until the mirror catches up the new admin will be 404'd at the
               edge, which looks exactly like the grant not working. */
            warning: mirror.mirrored
                ? undefined
                : `Admin granted, but the edge cache could not be refreshed (${mirror.error}). They may see 404 until it recovers.`,
        });
    } catch (error) {
        console.error("[admin/admins] grant failed:", error);
        return NextResponse.json({ error: "Failed to grant admin access" }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const auth = await requireRootAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const rawWallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
        const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) || null : null;

        if (!ADDRESS_PATTERN.test(rawWallet)) {
            return NextResponse.json(
                { error: "Enter a valid wallet address (0x followed by 40 hex characters)." },
                { status: 400 },
            );
        }
        const wallet = rawWallet.toLowerCase();

        /* Root admins are configured in env — there is no DB row to update. */
        if (listRootAdmins().includes(wallet)) {
            return NextResponse.json(
                { error: "Root admin labels cannot be managed here." },
                { status: 400 },
            );
        }

        try {
            await prisma.adminWallet.update({
                where: { wallet },
                data: { label },
            });
        } catch (e: unknown) {
            if (
                typeof e === "object" &&
                e !== null &&
                "code" in e &&
                (e as { code: string }).code === "P2025"
            ) {
                return NextResponse.json(
                    { error: "That wallet is not a delegated admin." },
                    { status: 404 },
                );
            }
            throw e;
        }

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_WALLET_UPDATE_LABEL",
            target: wallet,
            detail: { label },
            request,
        });

        return NextResponse.json({ success: true, wallet, label });
    } catch (error) {
        console.error("[admin/admins] update label failed:", error);
        return NextResponse.json({ error: "Failed to update admin label" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireRootAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const { searchParams } = new URL(request.url);
        const rawWallet = (searchParams.get("wallet") || "").trim();
        if (!ADDRESS_PATTERN.test(rawWallet)) {
            return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
        }
        const wallet = rawWallet.toLowerCase();

        /* Root admins are configured in env, so there is no row to delete and no way for
           this endpoint to honour the request. Failing loudly beats a success response
           that silently changes nothing. */
        if (listRootAdmins().includes(wallet)) {
            return NextResponse.json(
                {
                    error: "Root admins cannot be revoked here. Remove the wallet from ADMIN_WALLET_ADDRESSES and redeploy.",
                },
                { status: 400 },
            );
        }

        const deleted = await prisma.adminWallet.deleteMany({ where: { wallet } });
        if (deleted.count === 0) {
            return NextResponse.json({ error: "That wallet is not a delegated admin." }, { status: 404 });
        }

        const mirror = await mirrorDelegatedAdmins();
        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_WALLET_REVOKE",
            target: wallet,
            detail: { mirrored: mirror.mirrored },
            request,
        });

        return NextResponse.json({
            success: true,
            wallet,
            /* A stale mirror after a REVOKE is the security-relevant direction: the wallet
               keeps passing the edge gate until the TTL lapses. It still cannot act — the
               layout and every /api/admin handler re-check the database — but the operator
               should know the door has not shut yet. */
            warning: mirror.mirrored
                ? undefined
                : `Access revoked in the database, but the edge cache could not be refreshed (${mirror.error}). They may still load the console shell for up to 10 seconds; all admin actions are already blocked.`,
        });
    } catch (error) {
        console.error("[admin/admins] revoke failed:", error);
        return NextResponse.json({ error: "Failed to revoke admin access" }, { status: 500 });
    }
}
