import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { pgMaybeOne, withPgClient } from "@/lib/serverPg";
import { sanitizeInput } from "@/utils/security";

type EmbeddedWalletExportRecord = {
    email: string | null;
    provider: string | null;
    encrypted_private_key: string | null;
};

const ALGORITHM = "aes-256-gcm";

function decryptPrivateKey(encryptedText: string, secret: string): string {
    if (!secret) {
        throw new Error("WALLET_ENCRYPTION_KEY is required to decrypt legacy keys.");
    }
    const key = crypto.scryptSync(secret, "subscript:wallet:v2", 32);
    const [version, ivHex, authTagHex, encryptedHex] = encryptedText.split(":");
    if (version !== "v2" || !ivHex || !authTagHex || !encryptedHex) {
        throw new Error("Invalid encrypted format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

function otpSecret() {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return secret;
}

function hashOtp(email: string, code: string) {
    return crypto.createHmac("sha256", otpSecret()).update(`${email}:${code}`).digest("hex");
}

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

    const consumed = await withPgClient(async (client) => {
        const result = await client.query(
            `delete from otp_codes
              where email = $1
                and code = $2
                and expires_at > now()
            returning code, expires_at`,
            [emailLower, expectedHash]
        );
        return result.rows[0] as { code: string; expires_at: string } | undefined;
    });

    if (consumed) {
        return { ok: true };
    }

    const record = await withPgClient(async (client) => {
        const result = await client.query(
            `select expires_at from otp_codes where email = $1 limit 1`,
            [emailLower]
        );
        return result.rows[0] as { expires_at: string } | undefined;
    });

    if (!record) {
        return {
            ok: false,
            response: NextResponse.json({ error: "No active verification code. Request a new one.", code: "OTP_REQUIRED" }, { status: 401 }),
        };
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
        await withPgClient((client) => client.query(
            `delete from otp_codes where email = $1 and expires_at <= now()`,
            [emailLower]
        ));
        return {
            ok: false,
            response: NextResponse.json({ error: "Your verification code expired. Request a new one.", code: "OTP_EXPIRED" }, { status: 401 }),
        };
    }

    return {
        ok: false,
        response: NextResponse.json({ error: "Incorrect verification code.", code: "OTP_INVALID" }, { status: 401 }),
    };
}

export async function POST(request: Request) {
    return NextResponse.json({
        error: "Private key viewing and export is disabled. Embedded accounts are secured via multi-party computation and raw private keys are never exposed.",
        code: "PRIVATE_KEY_EXPORT_DISABLED",
    }, { status: 403 });
}
