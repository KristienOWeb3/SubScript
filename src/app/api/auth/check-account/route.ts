import { NextResponse } from "next/server";
import { sanitizeInput } from "@/utils/security";
import { pgMaybeOne, withPgClient } from "@/lib/serverPg";
import { findAccountEmailBinding, isWalletOnlyEmailBinding, normalizeAccountEmail } from "@/lib/auth/accountEmail";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { email, address } = sanitizeInput(body);

        if (email) {
            const emailLower = normalizeAccountEmail(email);
            if (!emailLower) {
                return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
            }

            const binding = await withPgClient((client) => findAccountEmailBinding(client, emailLower));
            if (binding) {
                const roleRecord = await pgMaybeOne<{ role: string }>(
                    "select role from account_roles where address = $1 limit 1",
                    [binding.walletAddress]
                );
                const onboardingComplete = Boolean(roleRecord?.role);
                return NextResponse.json({
                    exists: true,
                    hasWalletBinding: true,
                    onboardingComplete,
                    wallet: binding.walletAddress,
                    role: roleRecord?.role || null,
                    authMethod: isWalletOnlyEmailBinding(binding) ? "wallet" : "email",
                });
            }
            return NextResponse.json({
                exists: false,
                hasWalletBinding: false,
                onboardingComplete: false,
            });
        }

        if (address) {
            const addressLower = address.toLowerCase().trim();
            const roleRecord = await pgMaybeOne<{ role: string }>(
                "select role from account_roles where address = $1 limit 1",
                [addressLower]
            );
            if (roleRecord) {
                return NextResponse.json({
                    exists: true,
                    onboardingComplete: true,
                    wallet: addressLower,
                    role: roleRecord.role,
                });
            }
            return NextResponse.json({ exists: false, onboardingComplete: false });
        }

        return NextResponse.json({ error: "Missing email or address parameter" }, { status: 400 });
    } catch (err: any) {
        console.error("Check account error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
