import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface InviteTokenPayload {
    wallet: string;
    v: number; // tokenVersion
    n: string; // nonce
    t: number; // createdAt timestamp (ms)
}

function getInviteSecret(): Buffer {
    const secret =
        process.env.DM_INVITE_SECRET ||
        process.env.JWT_SECRET ||
        process.env.APP_SECRET ||
        "subscript-dm-invite-secret-default-seed";
    return Buffer.from(secret, "utf8");
}

function base64UrlEncode(data: string | Buffer): string {
    const base64 = (Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
        base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Generate a cryptographically signed HMAC token for a user's DM invite link.
 */
export function generateInviteToken(wallet: string, version: number, nonce: string): string {
    const normalizedWallet = wallet.toLowerCase();
    const payload: InviteTokenPayload = {
        wallet: normalizedWallet,
        v: version,
        n: nonce,
        t: Date.now(),
    };
    const payloadJson = JSON.stringify(payload);
    const encodedPayload = base64UrlEncode(payloadJson);

    const secret = getInviteSecret();
    const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest();
    const encodedSignature = base64UrlEncode(signature);

    return `${encodedPayload}.${encodedSignature}`;
}

/**
 * Decode and verify the HMAC signature of an invite token.
 * Uses constant-time comparison to prevent timing leaks.
 */
export function parseAndVerifyInviteTokenSignature(token: string): InviteTokenPayload | null {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [encodedPayload, encodedSignature] = parts;
    const secret = getInviteSecret();
    const expectedSignature = crypto.createHmac("sha256", secret).update(encodedPayload).digest();
    const expectedEncodedSignature = base64UrlEncode(expectedSignature);

    if (encodedSignature.length !== expectedEncodedSignature.length) {
        return null;
    }

    const isValid = crypto.timingSafeEqual(
        Buffer.from(encodedSignature, "utf8"),
        Buffer.from(expectedEncodedSignature, "utf8"),
    );

    if (!isValid) return null;

    try {
        const payloadJson = base64UrlDecode(encodedPayload);
        const parsed = JSON.parse(payloadJson) as InviteTokenPayload;
        if (!parsed.wallet || typeof parsed.v !== "number" || !parsed.n) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Resolves an invite token against the database settings.
 * Checks whether:
 * 1. Token signature is valid
 * 2. User has invite settings configured and enabled
 * 3. Token version matches current setting (rotation check)
 * 4. Token nonce matches current setting
 */
export async function resolveInviteToken(token: string): Promise<{
    valid: boolean;
    wallet?: string;
    error?: string;
    status?: "VALID" | "REVOKED" | "DISABLED" | "INVALID";
}> {
    const payload = parseAndVerifyInviteTokenSignature(token);
    if (!payload) {
        return { valid: false, error: "Invalid or tampered invite token", status: "INVALID" };
    }

    const settings = await prisma.dmInviteSetting.findUnique({
        where: { walletAddress: payload.wallet.toLowerCase() },
    });

    if (!settings) {
        return { valid: false, error: "Invite link is not active", status: "INVALID" };
    }

    if (!settings.enabled) {
        return { valid: false, error: "This user is currently not accepting DM requests", status: "DISABLED" };
    }

    if (settings.tokenVersion !== payload.v || settings.tokenNonce !== payload.n) {
        return { valid: false, error: "This invite link has been rotated or expired", status: "REVOKED" };
    }

    return {
        valid: true,
        wallet: payload.wallet.toLowerCase(),
        status: "VALID",
    };
}
