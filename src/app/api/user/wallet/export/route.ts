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

        if (record.encrypted_private_key) {
            if (!record.email) {
                return NextResponse.json({ error: "No email address associated with this wallet." }, { status: 400 });
            }
            const otpCheck = await verifyExportOtp(record.email, otpCode);
            if (!otpCheck.ok) {
                return otpCheck.response;
            }

            const encryptionSecret = process.env.WALLET_ENCRYPTION_KEY;
            if (!encryptionSecret) {
                return NextResponse.json({ error: "System Configuration Error: WALLET_ENCRYPTION_KEY missing" }, { status: 500 });
            }

            try {
                const decryptedKey = decryptPrivateKey(record.encrypted_private_key, encryptionSecret);
                return NextResponse.json({
                    success: true,
                    privateKey: decryptedKey,
                }, { status: 200 });
            } catch (err: any) {
                console.error("Failed to decrypt legacy key during export:", err);
                return NextResponse.json({ error: "Failed to decrypt private key." }, { status: 500 });
            }
        }

        return NextResponse.json({
            error: "This embedded wallet is secured with multi-party computation and its private key cannot be exported.",
            provider: record.provider || null,
        }, { status: 409 });
    } catch (error: any) {
        console.error("Wallet export failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
