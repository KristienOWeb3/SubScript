import { jwtVerify } from "jose";

/**
 * Helper to authenticate requests inside Next.js API routes by reading
 * the subscript_session_token cookie and verifying it as a signed JWT.
 * Returns the authenticated wallet address (lowercase), or null if unauthorized.
 */
export async function getSessionWallet(headers: Headers): Promise<string | null> {
    const cookieStore = headers.get("cookie") || "";
    const tokenMatch = cookieStore.match(/subscript_session_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) return null;

    try {
        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            throw new Error("JWT_SECRET environment variable is not defined");
        }
        const secret = new TextEncoder().encode(secretStr);
        const { payload } = await jwtVerify(token, secret);
        
        if (payload && typeof payload.address === "string") {
            return payload.address.toLowerCase();
        }
        return null;
    } catch (err) {
        console.error("JWT verification failed:", err);
        return null;
    }
}
