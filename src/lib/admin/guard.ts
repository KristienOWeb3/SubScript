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

export type AdminRole = "SUPER_ADMIN" | "SUPPORT" | "COMPLIANCE" | "FINANCE" | "ENGINEER";

export type AdminIdentity = {
    wallet: string;
    isRoot: boolean;
    role: AdminRole;
};

export function parseAdminRoleFromLabel(label?: string | null): AdminRole {
    if (!label) return "SUPER_ADMIN";
    const upper = label.toUpperCase();
    if (upper.includes("[SUPPORT]") || upper.startsWith("SUPPORT")) return "SUPPORT";
    if (upper.includes("[COMPLIANCE]") || upper.startsWith("COMPLIANCE")) return "COMPLIANCE";
    if (upper.includes("[FINANCE]") || upper.startsWith("FINANCE")) return "FINANCE";
    if (upper.includes("[ENGINEER]") || upper.startsWith("ENGINEER")) return "ENGINEER";
    return "SUPER_ADMIN";
}

export async function getAdminSession(headers: Headers): Promise<AdminIdentity | null> {
    try {
        const session = await getVerifiedSessionToken(headers);
        if (!session) return null;
        if (!(await isAdminWallet(session.wallet))) return null;
        const isRoot = isRootAdmin(session.wallet);
        let role: AdminRole = isRoot ? "SUPER_ADMIN" : "SUPER_ADMIN";
        if (!isRoot) {
            const adminRecord = await prisma.adminWallet.findUnique({
                where: { wallet: session.wallet.toLowerCase() },
                select: { label: true },
            }).catch(() => null);
            role = parseAdminRoleFromLabel(adminRecord?.label);
        }
        return { wallet: session.wallet, isRoot, role };
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
 * Guard for scoped roles. Root and SUPER_ADMIN have access to all actions.
 */
export async function requireRole(
    request: Request,
    allowedRoles: AdminRole[],
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: NextResponse }> {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth;
    if (auth.admin.isRoot || auth.admin.role === "SUPER_ADMIN") return auth;
    if (!allowedRoles.includes(auth.admin.role)) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: `Forbidden: This action requires one of the following roles: [${allowedRoles.join(", ")}]` },
                { status: 403 },
            ),
        };
    }
    return auth;
}

