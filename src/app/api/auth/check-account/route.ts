import { NextResponse } from "next/server";
import { sanitizeInput } from "@/utils/security";
import { pgMaybeOne } from "@/lib/serverPg";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { email, address } = sanitizeInput(body);

        if (email) {
            const emailLower = email.toLowerCase().trim();
            const wallet = await pgMaybeOne<{ wallet_address: string }>(
                "select wallet_address from user_embedded_wallets where email = $1 limit 1",
                [emailLower]
            );
            if (wallet) {
                const roleRecord = await pgMaybeOne<{ role: string }>(
                    "select role from account_roles where address = $1 limit 1",
                    [wallet.wallet_address.toLowerCase()]
                );
                if (roleRecord) {
                    return NextResponse.json({ exists: true, wallet: wallet.wallet_address, role: roleRecord.role });
                }
            }
            return NextResponse.json({ exists: false });
        }

        if (address) {
            const addressLower = address.toLowerCase().trim();
            const roleRecord = await pgMaybeOne<{ role: string }>(
                "select role from account_roles where address = $1 limit 1",
                [addressLower]
            );
            if (roleRecord) {
                return NextResponse.json({ exists: true, wallet: addressLower, role: roleRecord.role });
            }
            return NextResponse.json({ exists: false });
        }

        return NextResponse.json({ error: "Missing email or address parameter" }, { status: 400 });
    } catch (err: any) {
        console.error("Check account error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
