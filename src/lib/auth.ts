import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { pgQuery, withPgClient } from "@/lib/serverPg";

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

/* Session lifecycle logging.
 *
 * A user reported being signed out on one device after paying on another. Nothing in the session
 * layer explains that — tokens are per-login rows, `sessions.wallet` is not unique, and revocation
 * only ever deletes the hashes present in the caller's own cookie — but the reason it could not be
 * confirmed either way is that a rejected session used to return null from three separate branches
 * without recording anything. There was no evidence to look at after the fact.
 *
 * Logs the hash PREFIX, never the token: enough to correlate one session across create → verify →
 * reject in a log search, useless to anyone who reads the logs. The wallet address is already
 * present throughout these logs.
 */
type SessionEvent = "created" | "revoked" | "rejected";
type SessionRejectReason = "no-cookie" | "jwt-invalid" | "no-live-row" | "db-error";

function logSessionEvent(
    event: SessionEvent,
    detail: { wallet?: string | null; tokenHash?: string | null; reason?: SessionRejectReason; count?: number },
) {
    const parts = [`[auth] session ${event}`];
    if (detail.wallet) parts.push(`wallet=${detail.wallet}`);
    if (detail.tokenHash) parts.push(`token=${detail.tokenHash.slice(0, 12)}`);
    if (detail.reason) parts.push(`reason=${detail.reason}`);
    if (typeof detail.count === "number") parts.push(`count=${detail.count}`);
    console.info(parts.join(" "));
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

    logSessionEvent("created", { wallet: normalizedAddress, tokenHash: sessionTokenHash(token) });

    return { token, expiresAt };
}

export async function revokeSessionToken(headers: Headers) {
    const tokens = getCookieValues(headers.get("cookie") || "", "subscript_session_token");
    if (tokens.length === 0) return;
    const hashes = tokens.map(sessionTokenHash);
    await withPgClient((client) => client.query(
        "delete from sessions where token = any($1::text[])",
        [hashes]
    ));
    /* Every hash logged individually: a browser can hold both the legacy host-only cookie and the
       domain-wide one, and knowing which were revoked together is the point. */
    for (const hash of hashes) {
        logSessionEvent("revoked", { tokenHash: hash, count: hashes.length });
    }
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

    if (tokens.length === 0) {
        /* Not logged in is the overwhelmingly common case, so this stays at debug — it is only here
           so a "logged out" report can be told apart from a token that was present and rejected. */
        console.debug("[auth] session rejected reason=no-cookie");
        return null;
    }

    type Candidate = VerifiedSessionToken & { issuedAt: number; hash: string };
    const candidates: Candidate[] = [];

    for (const token of tokens) {
        try {
            const { payload } = await jwtVerify(token, jwtSecret(), {
                issuer: SESSION_ISSUER,
                audience: SESSION_AUDIENCE,
            });

            if (payload && typeof payload.address === "string" && typeof payload.jti === "string") {
                candidates.push({
                    token,
                    wallet: payload.address.toLowerCase(),
                    expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null,
                    issuedAt: typeof payload.iat === "number" ? payload.iat : 0,
                    hash: sessionTokenHash(token),
                });
            }
        } catch (e: any) {
            /* A cookie that exists but will not verify is the interesting case: expired, signed with
               a rotated JWT_SECRET, or minted for another issuer. Logged at info, with the hash
               prefix, because a whole fleet of these at once is what a secret rotation looks like. */
            logSessionEvent("rejected", {
                tokenHash: sessionTokenHash(token),
                reason: "jwt-invalid",
            });
            console.debug(`[auth] jwt verification detail: ${e.message}`);
        }
    }

    if (candidates.length === 0) return null;

    const hashes = candidates.map(c => c.hash);
    /* Banned accounts are filtered out HERE rather than at sign-in, because a ban issued
       mid-session would otherwise do nothing: sessions last 30 days, so a banned user's
       existing token would keep authorizing every request until it expired. This runs on
       every authenticated request, so the check is folded into the query that was already
       being made — no extra round trip.

       NOT EXISTS (rather than a join) so a wallet with several ban rows cannot duplicate
       session rows, and expires_at is honoured so temporary bans lapse on their own. */
    try {
        const liveSessions = await pgQuery<{ token: string }>(
            `select s.token
               from sessions s
              where s.token = ANY($1)
                and s.expires_at > now()
                and not exists (
                    select 1
                      from banned_accounts b
                     where lower(b.address) = lower(s.wallet)
                       and (b.expires_at is null or b.expires_at > now())
                )`,
            [hashes]
        );
        const liveHashes = new Set(liveSessions.map(s => s.token));

        let newestSession: Candidate | null = null;
        for (const candidate of candidates) {
            if (liveHashes.has(candidate.hash)) {
                if (!newestSession || candidate.issuedAt > newestSession.issuedAt) {
                    newestSession = candidate;
                }
            }
        }

        if (!newestSession) {
            /* The signature was good but no live row backs it: revoked by a logout, expired past its
               DB expiry, or the account is banned. This is the branch a "signed out unexpectedly"
               report lands in, so it logs the wallet and every hash that failed to match. */
            for (const candidate of candidates) {
                logSessionEvent("rejected", {
                    wallet: candidate.wallet,
                    tokenHash: candidate.hash,
                    reason: "no-live-row",
                });
            }
            return null;
        }
        return {
            token: newestSession.token,
            wallet: newestSession.wallet,
            expiresAt: newestSession.expiresAt,
        };
    } catch (e: any) {
        /* Fail closed, but say so loudly — a database blip here logs every user out at once, and
           that is indistinguishable from a real revocation without this line. */
        console.error(`[auth] Session database verification failed: ${e.message}`);
        logSessionEvent("rejected", {
            wallet: candidates[0]?.wallet,
            tokenHash: candidates[0]?.hash,
            reason: "db-error",
        });
        return null;
    }
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
