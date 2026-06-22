import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { pgMaybeOne } from "@/lib/serverPg";
import { decryptPrivateKey } from "@/lib/crypto";

type EmbeddedWalletExportRecord = {
    email: string | null;
    provider: string | null;
    encrypted_private_key: string | null;
};

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

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

        const privateKey = decryptPrivateKey(record.encrypted_private_key);
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
