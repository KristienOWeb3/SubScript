import { prisma } from "@/lib/prisma";

/**
 * Helper to authenticate requests inside Next.js API routes by reading
 * the subscript_session_token cookie and checking it against the database.
 * Returns the authenticated wallet address (lowercase), or null if unauthorized.
 */
export async function getSessionWallet(headers: Headers): Promise<string | null> {
    const cookieStore = headers.get("cookie") || "";
    const tokenMatch = cookieStore.match(/subscript_session_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) return null;

    const session = await prisma.session.findUnique({
        where: { token },
    });

    if (!session) return null;

    // Check if session has expired
    if (new Date() > session.expiresAt) {
        // Delete expired session in background
        prisma.session.delete({ where: { token } }).catch(() => null);
        return null;
    }

    return session.wallet;
}
