/* Public, address-keyed lookup used by the hosted checkout to decide whether to
   prompt a returning payer for their email. Returns only coarse booleans — no
   profile data — so it's safe to call without a session. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getAccountRole } from "@/lib/accounts/roles";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";
import { pgMaybeOne } from "@/lib/serverPg";

type WalletEmailRecord = {
    email: string | null;
    provider: string | null;
};

export async function GET(request: Request) {
    try {
        /* Throttle per-IP to limit account enumeration. */
        const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
        const rl = checkProviderRateLimit({ provider: "payer-status", key: ip, limit: 30, windowMs: 60_000 });
        if (!rl.ok) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }

        const address = new URL(request.url).searchParams.get("address") || "";
        if (!ethers.isAddress(address)) {
            return NextResponse.json({ error: "Invalid address" }, { status: 400 });
        }
        const normalized = address.toLowerCase();

        const role = await getAccountRole(normalized);
        let hasEmail = false;
        let isExternalWallet = false;
        if (role) {
            /* Email-OTP/Circle accounts keep their email in user_embedded_wallets;
               external wallets keep a verified contact email in customers. */
            const [embeddedWallet, customer] = await Promise.all([
                pgMaybeOne<WalletEmailRecord>(
                    "select email, provider from user_embedded_wallets where wallet_address = $1 limit 1",
                    [normalized],
                ),
                pgMaybeOne<{ email: string | null }>(
                    "select email from customers where wallet_address = $1 limit 1",
                    [normalized],
                ),
            ]);
            hasEmail = Boolean(embeddedWallet?.email || customer?.email);
            isExternalWallet = !embeddedWallet || embeddedWallet.provider === "external_wallet";
        }

        return NextResponse.json({
            exists: Boolean(role),
            hasEmail,
            isExternalWallet,
        }, { status: 200 });
    } catch (error: any) {
        console.error("payer-status lookup failed:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
