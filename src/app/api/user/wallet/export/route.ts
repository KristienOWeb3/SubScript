import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { pgMaybeOne, withPgClient } from "@/lib/serverPg";
import { decryptPrivateKey } from "@/lib/crypto";
import { sanitizeInput } from "@/utils/security";

type EmbeddedWalletExportRecord = {
    email: string | null;
    provider: string | null;
    encrypted_private_key: string | null;
};

function otpSecret() {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return secret;
}

function hashOtp(email: string, code: string) {
    return crypto.createHmac("sha256", otpSecret()).update(`${email}:${code}`).digest("hex");
}

function safeHashMatch(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected, "utf8");
    const actualBuffer = Buffer.from(actual, "utf8");
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Step-up authentication for the most destructive action on the platform: revealing a wallet's
 * raw private key. A valid session alone is not enough — exposing the key would let a stolen
 * cookie or an XSS payload drain the wallet irreversibly. The caller must present a fresh,
 * single-use OTP delivered to the account email (request one via /api/auth/otp/send).
 */
async function verifyExportOtp(email: string, code: string): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "A 6-digit verification code is required to export your private key.", code: "OTP_REQUIRED" },
                { status: 401 }
            ),
        };
    }

    const emailLower = email.toLowerCase();
    const expectedHash = hashOtp(emailLower, code);

    const record = await withPgClient(async (client) => {
        const result = await client.query(
            `select code, expires_at from otp_codes where email = $1 limit 1`,
            [emailLower]
        );
        return result.rows[0] as { code: string; expires_at: string } | undefined;
    });

    if (!record) {
        return {
            ok: false,
            response: NextResponse.json({ error: "No active verification code. Request a new one.", code: "OTP_REQUIRED" }, { status: 401 }),
        };
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
        await withPgClient((client) => client.query(`delete from otp_codes where email = $1`, [emailLower]));
        return {
            ok: false,
            response: NextResponse.json({ error: "Your verification code expired. Request a new one.", code: "OTP_EXPIRED" }, { status: 401 }),
        };
    }

    if (!safeHashMatch(record.code, expectedHash)) {
        return {
            ok: false,
            response: NextResponse.json({ error: "Incorrect verification code.", code: "OTP_INVALID" }, { status: 401 }),
        };
    }

    /* Single-use: consume the code so it cannot be replayed. */
    await withPgClient((client) => client.query(`delete from otp_codes where email = $1`, [emailLower]));
    return { ok: true };
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = sanitizeInput(await request.json().catch(() => ({}))) || {};
        const otpCode = typeof body.otpCode === "string" ? body.otpCode : "";

        const normalizedWallet = wallet.toLowerCase();
        const record = await pgMaybeOne<EmbeddedWalletExportRecord>(
            `select email, provider, encrypted_private_key
               from user_embedded_wallets
              where wallet_address = $1
              limit 1`,
            [normalizedWallet]
        );

        if (!record) {
            return NextResponse.json({
                error: "This account is using an external wallet. Export the key from your wallet app instead.",
            }, { status: 404 });
        }

        if (!record.encrypted_private_key) {
            return NextResponse.json({
                error: "This embedded wallet is managed by Circle/Google and does not expose a private key through SubScript.",
                provider: record.provider || null,
            }, { status: 409 });
        }

        if (!record.email) {
            return NextResponse.json({
                error: "This wallet has no verified email on file, so key export cannot be confirmed. Contact support.",
            }, { status: 409 });
        }

        /* Step-up: require a fresh OTP before disclosing the key. */
        const otpCheck = await verifyExportOtp(record.email, otpCode);
        if (!otpCheck.ok) {
            return otpCheck.response;
        }

        const privateKey = decryptPrivateKey(record.encrypted_private_key);

        /* Best-effort audit trail for this sensitive disclosure. */
        await withPgClient((client) =>
            client.query(
                `insert into audit_events (actor, action, resource_type, resource_id, metadata)
                 values ($1, 'WALLET_KEY_EXPORTED', 'WALLET', $1, $2::jsonb)`,
                [normalizedWallet, JSON.stringify({ provider: record.provider })]
            )
        ).catch((auditErr) => console.error("Failed to log wallet export audit event:", auditErr));

        return NextResponse.json({
            success: true,
            wallet: normalizedWallet,
            email: record.email,
            provider: record.provider,
            privateKey,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Wallet export failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
