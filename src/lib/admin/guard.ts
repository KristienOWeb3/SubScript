import { NextResponse } from "next/server";
import { getVerifiedSessionToken } from "@/lib/auth";
import { isRootAdmin } from "@/lib/admin/allowlist";
import { isAdminWallet } from "@/lib/admin/identity";

/* Authoritative admin check for Node-runtime code: the /admin layout and every
 * /api/admin route handler.
 *
 * This is a STRICTER check than the middleware gate, not a duplicate of it. Middleware
 * verifies the JWT signature only (see the comment above isAuthorizedAdmin in
 * proxy.ts) — it deliberately skips the sessions table to avoid a database round
 * trip on every request, so a token whose session was revoked by signing out still
 * passes it until the JWT expires. getVerifiedSessionToken DOES consult that table, so
 * a signed-out admin is rejected here.
 *
 * More importantly, middleware's admin gate never runs for /api/* at all (the isApiRoute
 * guard), so for API routes this is not a second layer — it is the ONLY layer.
 *
 * Admin identity spans two tiers (root from env, delegated from admin_wallets) — see
 * @/lib/admin/identity. requireAdmin admits both; requireRootAdmin admits only root.
 */

import { prisma } from "@/lib/prisma";
import {
    allScopes,
    hasScope,
    scopesForDelegatedAdmin,
    LEAST_PRIVILEGE_SCOPE,
    type AdminScope,
} from "@/lib/admin/scopes";

export type AdminIdentity = {
    wallet: string;
    isRoot: boolean;
    /* Everything this session may do. Root holds every scope; a delegated admin holds what
       its admin_wallets row grants, floored at `read`. See @/lib/admin/scopes. */
    scopes: AdminScope[];
};

export async function getAdminSession(headers: Headers): Promise<AdminIdentity | null> {
    try {
        const session = await getVerifiedSessionToken(headers);
        if (!session) return null;
        if (!(await isAdminWallet(session.wallet))) return null;

        const isRoot = isRootAdmin(session.wallet);
        if (isRoot) return { wallet: session.wallet, isRoot: true, scopes: allScopes() };

        /* Delegated. A failed read degrades to the least privilege rather than to full access:
           isAdminWallet() above already proved this wallet is an admin, so the console must
           still open, but nothing beyond `read` should be assumed from a row we could not
           read. This is the inversion of the previous behaviour, where an unrecognised label
           resolved to SUPER_ADMIN. */
        const adminRecord = await prisma.adminWallet
            .findUnique({
                where: { wallet: session.wallet.toLowerCase() },
                select: { scopes: true },
            })
            .catch((error) => {
                console.error("[admin] scope lookup failed, degrading to least privilege:", error);
                return null;
            });

        return {
            wallet: session.wallet,
            isRoot: false,
            scopes: adminRecord ? scopesForDelegatedAdmin(adminRecord.scopes) : [LEAST_PRIVILEGE_SCOPE],
        };
    } catch (error) {
        console.error("[admin] getAdminSession error:", error);
        return null;
    }
}

/**
 * Route-handler guard. Returns the admin identity, or a response to return as-is.
 *
 * Answers 404 rather than 401/403 for BOTH the unauthenticated and the not-an-admin
 * case, matching the console's non-disclosure posture in proxy.ts: a 403 confirms
 * the endpoint exists and that admin-only surface area is worth probing. The two cases
 * are deliberately indistinguishable to the caller.
 */
export async function requireAdmin(
    request: Request,
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: NextResponse }> {
    const admin = await getAdminSession(request.headers);
    if (!admin) {
        return {
            ok: false,
            response: NextResponse.json({ error: "Not Found" }, { status: 404 }),
        };
    }
    return { ok: true, admin };
}

/**
 * Guard for actions only root (env-configured) admins may perform: granting and revoking
 * delegated admin access.
 *
 * Delegated admins deliberately cannot manage the admin list. A delegated wallet that
 * could grant admin access could entrench itself and revoke the wallets of others, so a
 * single compromised console session would be unrecoverable without a redeploy. Keeping
 * the grant power in env means the recovery path is always outside the blast radius.
 *
 * Returns 403 (not 404) when a real admin lacks root: the caller is already known to be
 * an admin, so there is nothing left to conceal, and a 404 here would read as a bug.
 */
export async function requireRootAdmin(
    request: Request,
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: NextResponse }> {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth;
    if (!auth.admin.isRoot) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "Only root admins (ADMIN_WALLET_ADDRESSES) can manage admin access." },
                { status: 403 },
            ),
        };
    }
    return auth;
}

/**
 * Guard for a specific capability. Root and any admin holding `scope` pass.
 *
 * Answers 403, not 404, unlike requireAdmin: the caller is already known to be an admin, so
 * there is nothing left to conceal and a 404 here would read as a bug. Same reasoning as
 * requireRootAdmin above.
 *
 * Every /api/admin route should call this or requireRootAdmin rather than bare requireAdmin.
 * A route gated only by requireAdmin is open to every admin including the `read`-only tier,
 * which is how a support hire ended up able to decide KYC — see the header of
 * @/lib/admin/scopes.
 */
export async function requireScope(
    request: Request,
    scope: AdminScope,
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: NextResponse }> {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth;
    if (!hasScope(auth.admin.scopes, scope)) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: `Forbidden: this action requires the "${scope}" admin scope.` },
                { status: 403 },
            ),
        };
    }
    return auth;
}

/**
 * Guard for an action reachable through more than one capability — a transaction lookup that
 * support, compliance, and finance all legitimately need, for instance. Passing when the admin
 * holds ANY of `scopes` keeps routes from having to be duplicated per audience.
 */
export async function requireAnyScope(
    request: Request,
    scopes: AdminScope[],
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: NextResponse }> {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth;
    if (!scopes.some((scope) => hasScope(auth.admin.scopes, scope))) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: `Forbidden: this action requires one of these admin scopes: ${scopes.join(", ")}.` },
                { status: 403 },
            ),
        };
    }
    return auth;
}

