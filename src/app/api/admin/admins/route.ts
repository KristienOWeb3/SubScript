import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRootAdmin, requireScope } from "@/lib/admin/guard";
import { listDelegatedAdmins, listRootAdmins, mirrorDelegatedAdmins } from "@/lib/admin/identity";
import { recordAdminAction } from "@/lib/admin/audit";
import { ADMIN_SCOPES, normalizeScopes, scopesForDelegatedAdmin } from "@/lib/admin/scopes";

/* Admin access management.
 *
 * GET needs the `governance` scope: the roster names every wallet with console access and what
 * each of them may do, which is a map of the platform's own attack surface. POST/DELETE stay
 * root-only — see requireRootAdmin in @/lib/admin/guard for why the grant power stays in env.
 *
 * Scopes are assigned HERE and only here. They used to be inferred from the display label by
 * pattern-matching it (parseAdminRoleFromLabel), which meant relabelling an admin silently
 * changed their authority and any label that did not match a known prefix resolved to full
 * access. Authority is now an explicit field.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
    /* The roster names every wallet holding console access and what each may do — a map of
       the platform's own attack surface. Root holds `governance`; the grant, revoke, and
       relabel writes below stay requireRootAdmin. */
    const auth = await requireScope(request, "governance");
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
                scopes: scopesForDelegatedAdmin(entry.scopes),
                grantReason: entry.grantReason,
                expiresAt: entry.expiresAt?.toISOString() ?? null,
                /* Reported so the console can show a lapsed grant as inactive rather than
                   hiding it — listDelegatedAdmins deliberately does not filter these out. */
                expired: Boolean(entry.expiresAt && entry.expiresAt <= new Date()),
                /* Backfilled wide when scoping landed. Badged in the console so an operator
                   narrows these deliberately rather than finding out during an incident. */
                legacyFullScope: entry.legacyFullScope,
            })),
            /* The vocabulary, so the console's scope picker cannot drift from the validator. */
            availableScopes: ADMIN_SCOPES,
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
        const grantReason = typeof body?.grantReason === "string" ? body.grantReason.trim().slice(0, 500) : null;

        if (!ADDRESS_PATTERN.test(rawWallet)) {
            return NextResponse.json(
                { error: "Enter a valid wallet address (0x followed by 40 hex characters)." },
                { status: 400 },
            );
        }
        const wallet = rawWallet.toLowerCase();

        /* Scopes are REQUIRED on a new grant, and no default is supplied. The old code had no
           scope concept at all, so every grant was effectively unlimited; quietly defaulting to
           anything here would repeat that in a quieter way. An operator has to say what this
           person may do. */
        const scopes = normalizeScopes(body?.scopes);
        if (scopes.length === 0) {
            return NextResponse.json(
                { error: `Choose at least one scope for this admin. Valid scopes: ${ADMIN_SCOPES.join(", ")}.` },
                { status: 400 },
            );
        }

        /* NULL means permanent, matching the column. An expiry in the past would create a grant
           that is dead on arrival and read as a bug, so it is refused rather than stored. */
        let expiresAt: Date | null = null;
        if (body?.expiresAt !== undefined && body?.expiresAt !== null && body?.expiresAt !== "") {
            const parsed = new Date(body.expiresAt);
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "expiresAt is not a valid date." }, { status: 400 });
            }
            if (parsed <= new Date()) {
                return NextResponse.json({ error: "expiresAt must be in the future." }, { status: 400 });
            }
            expiresAt = parsed;
        }

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
            /* An explicit re-grant replaces the scope set rather than merging into it: merging
               would make narrowing someone impossible through this endpoint. legacyFullScope is
               cleared because the grant is no longer a backfill guess. */
            update: {
                label: label || undefined,
                scopes,
                expiresAt,
                grantReason: grantReason || undefined,
                legacyFullScope: false,
            },
            create: {
                wallet,
                label: label || null,
                grantedBy: auth.admin.wallet,
                scopes,
                expiresAt,
                grantReason: grantReason || null,
                legacyFullScope: false,
            },
        });

        const mirror = await mirrorDelegatedAdmins();
        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_WALLET_GRANT",
            target: wallet,
            detail: {
                label,
                scopes,
                grantReason,
                expiresAt: expiresAt?.toISOString() ?? null,
                mirrored: mirror.mirrored,
            },
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
        const hasLabel = typeof body?.label === "string";
        const label = hasLabel ? body.label.trim().slice(0, 120) || null : null;

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
                { error: "Root admin access cannot be managed here." },
                { status: 400 },
            );
        }

        /* Scopes are optional on a PATCH, so relabelling does not silently reset authority —
           which is the failure mode this whole change exists to remove. Narrowing a legacy
           wide grant is the main reason to send them. */
        const scopes = body?.scopes === undefined ? null : normalizeScopes(body.scopes);
        if (scopes !== null && scopes.length === 0) {
            return NextResponse.json(
                { error: `Choose at least one scope. Valid scopes: ${ADMIN_SCOPES.join(", ")}.` },
                { status: 400 },
            );
        }

        /* Explicit null clears the expiry (makes the grant permanent); an omitted field leaves
           it alone. The two have to be distinguishable or an expiry could never be lifted. */
        let expiresAt: Date | null | undefined;
        if (body?.expiresAt === null || body?.expiresAt === "") {
            expiresAt = null;
        } else if (body?.expiresAt !== undefined) {
            const parsed = new Date(body.expiresAt);
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "expiresAt is not a valid date." }, { status: 400 });
            }
            if (parsed <= new Date()) {
                return NextResponse.json({ error: "expiresAt must be in the future." }, { status: 400 });
            }
            expiresAt = parsed;
        }

        const grantReason =
            typeof body?.grantReason === "string" ? body.grantReason.trim().slice(0, 500) || null : undefined;

        if (!hasLabel && scopes === null && expiresAt === undefined && grantReason === undefined) {
            return NextResponse.json({ error: "No admin changes supplied." }, { status: 400 });
        }

        try {
            await prisma.adminWallet.update({
                where: { wallet },
                data: {
                    ...(hasLabel ? { label } : {}),
                    /* Narrowing a backfilled grant is exactly what legacy_full_scope was flagging,
                       so setting scopes explicitly clears the badge. */
                    ...(scopes !== null ? { scopes, legacyFullScope: false } : {}),
                    ...(expiresAt !== undefined ? { expiresAt } : {}),
                    ...(grantReason !== undefined ? { grantReason } : {}),
                },
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

        /* Scope and expiry changes alter who can reach the edge gate, so the mirror has to be
           rewritten — a narrowed or expired grant left in the Redis set would still pass
           middleware. A relabel alone does not affect membership, so it skips the rewrite. */
        const mirror =
            scopes !== null || expiresAt !== undefined
                ? await mirrorDelegatedAdmins()
                : { mirrored: true as const, error: undefined };

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_WALLET_UPDATE_LABEL",
            target: wallet,
            detail: {
                ...(hasLabel ? { label } : {}),
                ...(scopes !== null ? { scopes } : {}),
                ...(expiresAt !== undefined ? { expiresAt: expiresAt?.toISOString() ?? null } : {}),
                ...(grantReason !== undefined ? { grantReason } : {}),
                mirrored: mirror.mirrored,
            },
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
