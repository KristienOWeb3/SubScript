/* Bind an OTP-verified email to the logged-in user's customer profile.
   Used by the "add your email" prompt that wallet-onboarded users see. The email is confirmed
   with a 6-digit code (issued by /api/auth/otp/send) before it's stored, so wallet accounts
   can't register an address they don't control. */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";
import { withPgClient } from "@/lib/serverPg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashOtp(email: string, code: string) {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
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

        /* Consume the exact wallet-bound OTP atomically. Login OTPs and codes issued for another
           wallet are deliberately ineligible here, so the two authentication purposes cannot be
           confused or replayed across endpoints. */
        let consumedOtp = false;
        try {
            consumedOtp = await withPgClient(async (client) => {
                const result = await client.query(
                    `delete from otp_codes
                      where email = $1
                        and code = $2
                        and purpose = 'BIND_WALLET_EMAIL'
                        and wallet_address = $3
                        and expires_at > now()
                    returning email`,
                    [email, hashOtp(email, code), wallet.toLowerCase()]
                );
                return ((result as { rowCount?: number }).rowCount ?? 0) === 1;
            });
        } catch (err) {
            console.error("Email OTP consume failed:", err);
            return NextResponse.json({ error: "Verification is temporarily unavailable. Please try again." }, { status: 503 });
        }
        if (!consumedOtp) {
            return NextResponse.json({ error: "Invalid or expired verification code. Request a new one." }, { status: 400 });
        }

        try {
            await withPgClient(async (client) => {
                await client.query("begin");
                try {
                    await client.query(
                        `insert into customers (wallet_address, email)
                         values ($1, $2)
                         on conflict (wallet_address) do update set email = excluded.email`,
                        [wallet.toLowerCase(), email],
                    );
                    await client.query(
                        `insert into user_embedded_wallets
                            (wallet_address, email, provider, email_verified_at, updated_at)
                         values ($1, $2, 'external_wallet_email_otp', now(), now())
                         on conflict (wallet_address) do update set
                            email = excluded.email,
                            provider = case
                                when user_embedded_wallets.provider = 'external_wallet'
                                    then excluded.provider
                                else user_embedded_wallets.provider
                            end,
                            email_verified_at = now(),
                            updated_at = now()`,
                        [wallet.toLowerCase(), email],
                    );
                    await client.query("commit");
                } catch (error) {
                    await client.query("rollback").catch(() => undefined);
                    throw error;
                }
            });
        } catch (e: any) {
            /* A DB trigger enforces one email per account — surface that as a clean conflict. */
            if (e?.code === "23505" || /already associated|23505/i.test(String(e?.message || ""))) {
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
