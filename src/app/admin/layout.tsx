import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/admin/guard";
import AdminUnavailable from "./AdminUnavailable";

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
    const headerList = await headers();
    let admin;
    try {
        admin = await getAdminSession(headerList);
    } catch {
        // Layout errors bypass the same segment's error boundary. Render recovery here
        // without mounting any protected children; only a verified denial is 404.
        return <AdminUnavailable />;
    }
    if (!admin) notFound();

    return <>{children}</>;
}
