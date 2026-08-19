import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/admin/guard";

/* Authoritative admin gate.
 *
 * Middleware is the cheap edge filter (JWT signature + allowlist, no database) and
 * deliberately skips the sessions table so signing out doesn't revoke until the token
 * expires. THIS layout is the check middleware's comment reserves for the page tree:
 * getAdminSession() verifies against the live sessions table, so a signed-out admin
 * is rejected here even with a valid JWT. See the comment in proxy.ts above
 * isAuthorizedAdmin.
 *
 * force-dynamic: this gate reads cookies/headers and the database on every request —
 * it must never be statically rendered or cached, or the page tree would leak behind
 * the gate's back.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    try {
        const headerList = await headers();
        const admin = await getAdminSession(headerList);
        if (!admin) notFound();
        return <>{children}</>;
    } catch (err: any) {
        if (err?.digest?.startsWith("NEXT_NOT_FOUND") || err?.message === "NEXT_NOT_FOUND") {
            throw err;
        }
        console.error("[admin] AdminLayout gate error:", err);
        notFound();
    }
}
