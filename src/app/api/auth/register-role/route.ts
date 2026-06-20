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
        const { role, email } = sanitizedBody;

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

                if (emailVal) {
                    await assertAccountEmailAvailable(client, emailVal, normalizedWallet);

                    await client.query(
                        `insert into user_embedded_wallets (wallet_address, email, provider)
                         values ($1, $2, 'external_wallet')
                         on conflict (wallet_address) do update set email = excluded.email, updated_at = now()`,
                        [normalizedWallet, emailVal]
                    );
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
                    if (emailVal) {
                        await client.query(
                            `insert into customers (wallet_address, email)
                            values ($1, $2)
                            on conflict (wallet_address) do update set email = excluded.email`,
                            [normalizedWallet, emailVal]
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

        if (accountRole.alreadyRegistered) {
            if (accountRole.role !== role) {
                return NextResponse.json({
                    error: `This wallet is already registered as ${accountRole.role}. Use a different wallet for ${role}.`,
                    role: accountRole.role,
                }, { status: 409 });
            }
            return NextResponse.json({ success: true, role: accountRole.role, message: "Role already registered for this wallet" }, { status: 200 });
        }

        const emailRecord = await withPgClient(async (client) => {
            const result = await client.query(
                "select email from user_embedded_wallets where wallet_address = $1 limit 1",
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
