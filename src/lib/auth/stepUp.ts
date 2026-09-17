import crypto from "node:crypto";
import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { getVerifiedSessionToken, type VerifiedSessionToken } from "@/lib/auth";

const STEP_UP_ISSUER = "subscriptonarc.com";
const STEP_UP_AUDIENCE = "subscript-financial-step-up";
const STEP_UP_TTL_SECONDS = 5 * 60;
const RECENT_AUTH_MAX_AGE_MS = 5 * 60 * 1000;

export type FinancialStepUpBinding = {
    action: string;
    recipient?: string;
    amount?: string;
    resourceId?: string;
};

export type FinancialStepUpAuthorization =
    | { ok: true; method: "recent-auth" | "otp"; session: VerifiedSessionToken }
    | { ok: false; status: 401 | 403; error: string };

function stepUpSecret() {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return new TextEncoder().encode(secret);
}

function sessionDigest(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function optionalBoundString(value: unknown, maxLength: number) {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
}

/**
 * Validate and canonicalize the exact operation a step-up token authorizes.
 * Unknown fields are discarded so callers cannot accidentally sign one shape and
 * enforce another. Addresses are lowercase because EVM destinations are compared
 * case-insensitively elsewhere in the financial routes.
 */
export function normalizeFinancialStepUpBinding(input: unknown): FinancialStepUpBinding | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    const action = optionalBoundString(value.action, 80);
    if (!action || !/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(action)) return null;

    const recipient = optionalBoundString(value.recipient, 120);
    const amount = optionalBoundString(value.amount, 100);
    const resourceId = optionalBoundString(value.resourceId, 160);
    if (recipient === null || amount === null || resourceId === null) return null;
    if (amount !== undefined && !/^\d+$/.test(amount)) return null;

    return {
        action,
        ...(recipient !== undefined ? { recipient: recipient.toLowerCase() } : {}),
        ...(amount !== undefined ? { amount: BigInt(amount).toString() } : {}),
        ...(resourceId !== undefined ? { resourceId } : {}),
    };
}

function bindingsMatch(actual: unknown, expected: FinancialStepUpBinding) {
    const normalized = normalizeFinancialStepUpBinding(actual);
    return normalized !== null
        && normalized.action === expected.action
        && normalized.recipient === expected.recipient
        && normalized.amount === expected.amount
        && normalized.resourceId === expected.resourceId;
}

export async function createFinancialStepUpToken(
    session: VerifiedSessionToken,
    bindingInput: unknown,
) {
    const binding = normalizeFinancialStepUpBinding(bindingInput);
    if (!binding) throw new Error("Invalid financial step-up binding");

    const nowSeconds = Math.floor(Date.now() / 1000);
    return new SignJWT({
        wallet: session.wallet.toLowerCase(),
        session: sessionDigest(session.token),
        binding,
    })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(STEP_UP_ISSUER)
        .setAudience(STEP_UP_AUDIENCE)
        .setSubject(session.wallet.toLowerCase())
        .setJti(crypto.randomUUID())
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + STEP_UP_TTL_SECONDS)
        .sign(stepUpSecret());
}

export async function authorizeFinancialStepUp(input: {
    headers: Headers;
    wallet: string;
    binding: unknown;
    session?: VerifiedSessionToken;
    allowRecentAuth?: boolean;
    recentAuthMaxAgeMs?: number;
}): Promise<FinancialStepUpAuthorization> {
    const session = input.session ?? await getVerifiedSessionToken(input.headers);
    const wallet = input.wallet.toLowerCase();
    if (!session || session.wallet.toLowerCase() !== wallet) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const binding = normalizeFinancialStepUpBinding(input.binding);
    if (!binding) {
        return { ok: false, status: 403, error: "Invalid financial authorization binding." };
    }

    const suppliedToken = input.headers.get("x-step-up-token")?.trim();
    if (suppliedToken) {
        try {
            const { payload } = await jwtVerify(suppliedToken, stepUpSecret(), {
                issuer: STEP_UP_ISSUER,
                audience: STEP_UP_AUDIENCE,
                subject: wallet,
            });
            if (
                payload.wallet === wallet
                && payload.session === sessionDigest(session.token)
                && bindingsMatch(payload.binding, binding)
            ) {
                return { ok: true, method: "otp", session };
            }
        } catch {
            // A malformed, expired, or differently scoped token is simply not authorization.
        }
    }

    if (input.allowRecentAuth !== false) {
        try {
            const payload = decodeJwt(session.token);
            const authenticatedAt = payload.authenticatedAt;
            const maxAgeMs = input.recentAuthMaxAgeMs ?? RECENT_AUTH_MAX_AGE_MS;
            const ageMs = typeof authenticatedAt === "number" ? Date.now() - authenticatedAt : Number.POSITIVE_INFINITY;
            if (ageMs >= 0 && ageMs <= maxAgeMs) {
                return { ok: true, method: "recent-auth", session };
            }
        } catch {
            // getVerifiedSessionToken already verified the JWT. Decode failure means fail closed.
        }
    }

    return {
        ok: false,
        status: 403,
        error: "Fresh verification is required for this financial operation.",
    };
}
