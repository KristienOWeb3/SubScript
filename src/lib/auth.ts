import { jwtVerify } from "jose";

/**
 * Parse the raw cookie header, find the target cookie by name,
 * and return the cleaned value (trimmed and stripped of surrounding quotes).
 */
export function getCookieValue(cookieHeader: string, name: string): string | null {
    const pattern = new RegExp(`(?:^|;\\s*)${name}\\s*=\\s*([^;]*)`);
    const match = cookieHeader.match(pattern);
    if (!match) return null;
    let value = match[1].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
    }
    return value;
}

/**
 * Helper to authenticate requests inside Next.js API routes by reading
 * the subscript_session_token cookie and verifying it as a signed JWT.
 * Returns the authenticated wallet address (lowercase), or null if unauthorized.
 */
export async function getSessionWallet(headers: Headers): Promise<string | null> {
    const cookieStore = headers.get("cookie") || "";
    const token = getCookieValue(cookieStore, "subscript_session_token");

    if (!token) return null;

    try {
        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            throw new Error("JWT_SECRET environment variable is not defined");
        }
        const secret = new TextEncoder().encode(secretStr);
        const { payload } = await jwtVerify(token, secret);

        /* Circle social completion previously trusted browser-supplied identity fields. Reject
           every session minted through that path until server-side token verification is live. */
        if (payload.provider === "google") {
            return null;
        }

        if (payload && typeof payload.address === "string") {
            return payload.address.toLowerCase();
        }
        return null;
    } catch (err) {
        console.error("JWT verification failed:", err);
        return null;
    }
}
