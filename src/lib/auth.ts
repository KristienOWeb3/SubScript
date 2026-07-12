import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { pgMaybeOne, withPgClient } from "@/lib/serverPg";

const SESSION_ISSUER = "subscriptonarc.com";
const SESSION_AUDIENCE = "subscript-app";

function jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET environment variable is not defined");
    return new TextEncoder().encode(secret);
}

function sessionTokenHash(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSessionToken(address: string, durationMs: number) {
    const normalizedAddress = address.toLowerCase();
    const now = Date.now();
    const expiresAt = new Date(now + durationMs);
    const jti = crypto.randomUUID();
    const token = await new SignJWT({ address: normalizedAddress, authenticatedAt: now })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(SESSION_ISSUER)
        .setAudience(SESSION_AUDIENCE)
        .setJti(jti)
        .setIssuedAt(Math.floor(now / 1000))
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(jwtSecret());

    await withPgClient((client) => client.query(
        `insert into sessions (wallet, token, expires_at)
         values ($1, $2, $3)`,
        [normalizedAddress, sessionTokenHash(token), expiresAt]
    ));

    return { token, expiresAt };
}

export async function revokeSessionToken(headers: Headers) {
    const tokens = getCookieValues(headers.get("cookie") || "", "subscript_session_token");
    if (tokens.length === 0) return;
    await withPgClient((client) => client.query(
        "delete from sessions where token = any($1::text[])",
        [tokens.map(sessionTokenHash)]
    ));
}

/**
 * Parse the raw cookie header, find the target cookie by name,
 * and return the cleaned value (trimmed and stripped of surrounding quotes).
 */
export function getCookieValue(cookieHeader: string, name: string): string | null {
    return getCookieValues(cookieHeader, name)[0] ?? null;
}

/**
 * Return every cookie value with this name. Browsers may send both a legacy host-only
 * cookie and the current domain-wide cookie in the same header; cookie ordering is not
 * a reliable way to decide which session is current.
 */
export function getCookieValues(cookieHeader: string, name: string): string[] {
    const pattern = new RegExp(`(?:^|;\\s*)${name}\\s*=\\s*([^;]*)`);
    const values: string[] = [];
    let remaining = cookieHeader;

    while (remaining) {
        const match = remaining.match(pattern);
        if (!match || match.index === undefined) break;

        let value = match[1].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        if (value && !values.includes(value)) values.push(value);

        const consumed = match.index + match[0].length;
        remaining = remaining.slice(consumed);
    }

    return values;
}

export type VerifiedSessionToken = {
    token: string;
    wallet: string;
    expiresAt: Date | null;
};

/**
 * Read and verify the session JWT from the request cookie. Returns the raw token,
 * the authenticated wallet, and the token's own expiry (never extended) so callers
 * can re-issue the exact same session cookie with current scoping options.
 */
export async function getVerifiedSessionToken(headers: Headers): Promise<VerifiedSessionToken | null> {
    const cookieStore = headers.get("cookie") || "";
    const tokens = getCookieValues(cookieStore, "subscript_session_token");

    if (tokens.length === 0) return null;

    let newestSession: (VerifiedSessionToken & { issuedAt: number }) | null = null;
    for (const token of tokens) {
        try {
            const { payload } = await jwtVerify(token, jwtSecret(), {
                issuer: SESSION_ISSUER,
                audience: SESSION_AUDIENCE,
            });

            if (payload && typeof payload.address === "string" && typeof payload.jti === "string") {
                const address = payload.address.toLowerCase();
                /* Revocation check (finding 21): the token must still have a live row in `sessions`,
                   so logout can invalidate a copied token. */
                const session = await pgMaybeOne<{ wallet: string }>(
                    `select wallet from sessions
                      where token = $1
                        and lower(wallet) = $2
                        and expires_at > now()
                      limit 1`,
                    [sessionTokenHash(token), address]
                );
                if (!session) continue;
                const candidate = {
                    token,
                    wallet: address,
                    expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null,
                    issuedAt: typeof payload.iat === "number" ? payload.iat : 0,
                };
                if (!newestSession || candidate.issuedAt > newestSession.issuedAt) {
                    newestSession = candidate;
                }
            }
        } catch {
            /* A duplicate legacy cookie may be expired or signed by a rotated secret.
               Keep checking the remaining same-name cookies before rejecting the request. */
        }
    }

    if (!newestSession) return null;
    const { issuedAt: _issuedAt, ...verifiedSession } = newestSession;
    return verifiedSession;
}

/**
 * Helper to authenticate requests inside Next.js API routes by reading
 * the subscript_session_token cookie and verifying it as a signed JWT.
 * Returns the authenticated wallet address (lowercase), or null if unauthorized.
 */
export async function getSessionWallet(headers: Headers): Promise<string | null> {
    const session = await getVerifiedSessionToken(headers);
    return session?.wallet ?? null;
}
