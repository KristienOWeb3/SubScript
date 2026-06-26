/* Bind an OTP-verified email to the logged-in user's customer profile.
   Used by the "add your email" prompt that wallet-onboarded users see. The email is confirmed
   with a 6-digit code (issued by /api/auth/otp/send) before it's stored, so wallet accounts
   can't register an address they don't control. */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";
import { withPgClient } from "@/lib/serverPg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashOtp(email: string, code: string) {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function safeHashMatch(expected: string, actual: string) {
    const e = Buffer.from(expected, "utf8");
    const a = Buffer.from(actual, "utf8");
    return e.length === a.length && crypto.timingSafeEqual(e, a);
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const code = typeof body?.code === "string" ? body.code.trim() : "";
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
        }
        if (!/^\d{6}$/.test(code)) {
            return NextResponse.json({ error: "Enter the 6-digit code we emailed you." }, { status: 400 });
        }

        /* Confirm the email with the OTP issued by /api/auth/otp/send before binding it. */
        let otpRecord: { code: string; expires_at: string | Date } | null;
        try {
            otpRecord = await withPgClient(async (client) => {
                const result = await client.query(
                    "select code, expires_at from otp_codes where email = $1 limit 1",
                    [email]
                );
                return result.rows[0] || null;
            });
        } catch (err) {
            console.error("Email OTP lookup failed:", err);
            return NextResponse.json({ error: "Verification is temporarily unavailable. Please try again." }, { status: 503 });
        }
        if (!otpRecord) {
            return NextResponse.json({ error: "Verification code expired or not found. Request a new one." }, { status: 400 });
        }
        if (!safeHashMatch(otpRecord.code, hashOtp(email, code))) {
            return NextResponse.json({ error: "Invalid verification code. Please check and try again." }, { status: 400 });
        }
        if (new Date() > new Date(otpRecord.expires_at)) {
            await withPgClient((client) => client.query("delete from otp_codes where email = $1", [email])).catch(() => {});
            return NextResponse.json({ error: "Verification code has expired. Request a new one." }, { status: 400 });
        }
        /* Consume the code so it can't be replayed. */
        await withPgClient((client) => client.query("delete from otp_codes where email = $1", [email])).catch(() => {});

        try {
            await prisma.customer.upsert({
                where: { walletAddress: wallet.toLowerCase() },
                update: { email },
                create: { walletAddress: wallet.toLowerCase(), email },
            });
        } catch (e: any) {
            /* A DB trigger enforces one email per account — surface that as a clean conflict. */
            if (e?.code === "P2002" || /already associated|23505/i.test(String(e?.message || ""))) {
                return NextResponse.json({ error: "That email is already linked to another SubScript account." }, { status: 409 });
            }
            throw e;
        }

        /* Wallet-onboarded users: their verified email name becomes their default .sub username
           (only if they don't already have one; changeable later). */
        await ensureDefaultAliasFromEmail(wallet, email);

        return NextResponse.json({ success: true, email }, { status: 200 });
    } catch (error: any) {
        console.error("Failed to save user email:", error);
        return NextResponse.json({ error: error.message || "Failed to save email" }, { status: 500 });
    }
}
