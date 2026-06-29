/* Starts a Transak fiat on-ramp session for the authenticated user. Returns a
   widget URL bound to the user's own session wallet, which the client mounts via
   @transak/ui-js-sdk. Funds are delivered non-custodially to the user's wallet. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { buildTransakWidgetUrl, isTransakConfigured } from "@/lib/onramp/transak";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        if (!isTransakConfigured()) {
            return NextResponse.json(
                { error: "Fiat on-ramp is not configured on this server." },
                { status: 503 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const fiatAmountRaw = Number(body?.fiatAmount);
        const fiatAmount = Number.isFinite(fiatAmountRaw) && fiatAmountRaw > 0 ? fiatAmountRaw : undefined;
        const fiatCurrency = typeof body?.fiatCurrency === "string"
            ? body.fiatCurrency.trim().slice(0, 8).toUpperCase()
            : "USD";

        const widgetUrl = buildTransakWidgetUrl({
            walletAddress: wallet,
            fiatAmount,
            fiatCurrency,
            /* Lets the webhook map an order back to this user without storing PII. */
            partnerOrderId: `${wallet.toLowerCase()}-${Date.now()}`,
        });

        return NextResponse.json({ widgetUrl }, { status: 200 });
    } catch (err: any) {
        console.error("Transak session error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
