/* API route to register or update account role (USER or ENTERPRISE) for authenticated wallets */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { withPgClient } from "@/lib/serverPg";
import { AccountEmailConflictError, assertAccountEmailAvailable, normalizeAccountEmail } from "@/lib/auth/accountEmail";
import { sanitizeInput } from "@/utils/security";
import { safelySendEmail, sendWelcomeEmail } from "@/lib/email/transactional";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { role, email, merchantSignupCode } = sanitizedBody;

        if (role !== "USER" && role !== "ENTERPRISE") {
            return NextResponse.json({ error: "Invalid role selected" }, { status: 400 });
        }

        const emailVal = normalizeAccountEmail(email);

        const normalizedWallet = wallet.toLowerCase();

        const accountRole = await withPgClient(async (client) => {
            await client.query("begin");
            try {
                const existingRoleResult = await client.query(
                    "select role from account_roles where address = $1 limit 1",
                    [normalizedWallet]
                );
                const existingRole = existingRoleResult.rows[0] || null;

                if (existingRole) {
                    await client.query("commit");
                    return {
                        role: existingRole.role,
                        alreadyRegistered: true,
                    };
                }

                /* Never trust an email copied from the role-selection form. Email ownership is
                   established only by the OTP/OAuth routes, which persist email_verified_at. */
                const verifiedEmailResult = await client.query(
                    `select email
                       from user_embedded_wallets
                      where wallet_address = $1
                        and email is not null
                        and email_verified_at is not null
                      limit 1`,
                    [normalizedWallet],
                );
                const verifiedEmailVal = normalizeAccountEmail(verifiedEmailResult.rows[0]?.email);

                if (role === "ENTERPRISE") {
                    /* Self-serve merchant signup is open by default. Set ALLOW_PUBLIC_MERCHANT_SIGNUP
                       ="false" to re-gate it behind a MERCHANT_SIGNUP_CODE invite. Either way, merchant
                       accounts must still be email/embedded (checked below) and KYB verification still
                       gates trust-sensitive capabilities. */
                    const disableFlag = (process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP || "").trim().toLowerCase();
                    const publicMerchantSignupEnabled = !["false", "0", "no", "off"].includes(disableFlag);
                    const requiredMerchantCode = process.env.MERCHANT_SIGNUP_CODE;
                    const providedMerchantCode = typeof merchantSignupCode === "string" ? merchantSignupCode.trim() : "";
                    const hasValidInviteCode = Boolean(requiredMerchantCode) && providedMerchantCode === requiredMerchantCode;

                    if (!publicMerchantSignupEnabled && !hasValidInviteCode) {
                        await client.query("rollback");
                        return {
                            role: "ENTERPRISE",
                            alreadyRegistered: false,
                            forbidden: true,
                        };
                    }

                    /* Merchant accounts must be email/embedded (server-recoverable) wallets, never an
                       external/self-custody wallet — more professional, and required for server-signed
                       merchant operations (payouts, tier changes, vault draws). */
                    const merchantKeyRow = await client.query(
                        "select encrypted_private_key, circle_wallet_id from user_embedded_wallets where wallet_address = $1 limit 1",
                        [normalizedWallet]
                    );
                    if (!merchantKeyRow.rows[0]?.encrypted_private_key && !merchantKeyRow.rows[0]?.circle_wallet_id) {
                        await client.query("rollback");
                        return {
                            role: "ENTERPRISE",
                            alreadyRegistered: false,
                            externalWalletMerchant: true,
                        };
                    }
                }

                if (verifiedEmailVal) {
                    await assertAccountEmailAvailable(client, verifiedEmailVal, normalizedWallet);
                }

                const createdRoleResult = await client.query(
                    "insert into account_roles (address, role) values ($1, $2) returning role",
                    [normalizedWallet, role]
                );

                if (role === "ENTERPRISE") {
                    await client.query("delete from customers where wallet_address = $1", [normalizedWallet]);
                    await client.query(
                        `insert into merchants (
                            wallet_address,
                            tier,
                            available_balance_usdc,
                            reserved_balance_usdc
                        ) values ($1, 'FREE', 0, 0)
                        on conflict (wallet_address) do update set
                            updated_at = now()`,
                        [normalizedWallet]
                    );
                } else {
                    await client.query("delete from merchants where wallet_address = $1", [normalizedWallet]);
                    if (verifiedEmailVal) {
                        await client.query(
                            `insert into customers (wallet_address, email)
                            values ($1, $2)
                            on conflict (wallet_address) do update set email = excluded.email`,
                            [normalizedWallet, verifiedEmailVal]
                        );
                    } else {
                        await client.query(
                            `insert into customers (wallet_address)
                            values ($1)
                            on conflict (wallet_address) do nothing`,
                            [normalizedWallet]
                        );
                    }
                }

                await client.query("commit");
                return {
                    role: createdRoleResult.rows[0].role,
                    alreadyRegistered: false,
                };
            } catch (error) {
                await client.query("rollback");
                throw error;
            }
        });

        if (accountRole.forbidden) {
            return NextResponse.json({
                error: "Merchant onboarding is invite-only. Sign up as a user or use a valid merchant invite link.",
            }, { status: 403 });
        }

        if (accountRole.externalWalletMerchant) {
            return NextResponse.json({
                error: "Merchant accounts must be created with email or Google sign-in — an external wallet can't open a merchant account.",
            }, { status: 403 });
        }

        if (accountRole.alreadyRegistered) {
            if (accountRole.role !== role) {
                /* Roles are separate and immutable per account. Give an actionable message instead of
                   a dead-end, distinguishing the common "personal user wants a merchant account" case. */
                const message = accountRole.role === "USER" && role === "ENTERPRISE"
                    ? "This email is already a personal SubScript account. Merchant accounts are separate — create your merchant account with a different email or wallet. Need to convert an existing account? Contact support."
                    : "This account is already registered as a merchant. Use a different email or wallet to create a personal account.";
                return NextResponse.json({
                    error: message,
                    role: accountRole.role,
                    code: "ROLE_ALREADY_REGISTERED",
                }, { status: 409 });
            }
            return NextResponse.json({ success: true, role: accountRole.role, message: "Role already registered for this wallet" }, { status: 200 });
        }

        const emailRecord = await withPgClient(async (client) => {
            const result = await client.query(
                "select email from user_embedded_wallets where wallet_address = $1 and email_verified_at is not null limit 1",
                [normalizedWallet]
            );
            return result.rows[0] || null;
        });
        if (typeof emailRecord?.email === "string") {
            await safelySendEmail("account welcome", () => sendWelcomeEmail(emailRecord.email, accountRole.role, normalizedWallet));
        }

        return NextResponse.json({ success: true, role: accountRole.role }, { status: 200 });
    } catch (err: any) {
        if (err instanceof AccountEmailConflictError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        if (err?.code === "23505") {
            return NextResponse.json({ error: "This wallet or email already has an account. Please sign in again." }, { status: 409 });
        }
        console.error("Failed to register role:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
