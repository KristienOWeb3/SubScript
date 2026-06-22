/* Merchant multisig (Safe) security.
 *
 * Lets a merchant designate a Gnosis Safe they own as their payout destination. We verify on-chain
 * that the address is a real Safe and that the merchant is one of its owners, then flag the account
 * as multisig-secured. No custom contracts: the Safe is an externally-owned, audited multisig.
 *
 * The on-chain payout-destination change (router configurePayoutDestination) is performed by the
 * existing rerouting flow; this endpoint owns the verification + the security flag + the DB record.
 */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySafe } from "@/lib/safe";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!supabaseAdmin) return NextResponse.json({ error: "Database not available" }, { status: 500 });

        const { data: merchant } = await supabaseAdmin
            .from("merchants")
            .select("payout_destination, security_multi_sig_enabled")
            .eq("wallet_address", wallet.toLowerCase())
            .maybeSingle();

        const safeAddress = merchant?.payout_destination || null;
        const enabled = !!merchant?.security_multi_sig_enabled;

        /* Re-verify so a stale flag never claims protection that no longer holds on-chain. */
        const safeInfo = enabled && safeAddress ? await verifySafe(safeAddress, wallet) : null;

        return NextResponse.json({
            securityMultiSigEnabled: enabled,
            safeAddress,
            safe: safeInfo,
        });
    } catch (err: any) {
        console.error("[merchant/multisig] GET error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!supabaseAdmin) return NextResponse.json({ error: "Database not available" }, { status: 500 });

        const body = await request.json().catch(() => null);
        const walletLower = wallet.toLowerCase();

        /* Disable multisig protection (keeps the payout destination as-is). */
        if (body?.disable === true) {
            const { error } = await supabaseAdmin
                .from("merchants")
                .update({ security_multi_sig_enabled: false, updated_at: new Date().toISOString() })
                .eq("wallet_address", walletLower);
            if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 });
            return NextResponse.json({ securityMultiSigEnabled: false });
        }

        const safeAddress = body?.safeAddress;
        if (!safeAddress || typeof safeAddress !== "string") {
            return NextResponse.json({ error: "safeAddress is required" }, { status: 400 });
        }

        const safe = await verifySafe(safeAddress, wallet);
        if (!safe.isSafe) {
            return NextResponse.json({ error: safe.error || "Address is not a Gnosis Safe.", safe }, { status: 400 });
        }
        if (!safe.isOwner) {
            return NextResponse.json(
                { error: "Your connected wallet is not an owner of that Safe. Add it as an owner first.", safe },
                { status: 403 }
            );
        }

        const { error } = await supabaseAdmin
            .from("merchants")
            .upsert(
                {
                    wallet_address: walletLower,
                    payout_destination: safeAddress.toLowerCase(),
                    security_multi_sig_enabled: true,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "wallet_address" }
            );
        if (error) {
            console.error("[merchant/multisig] upsert failed:", error.message);
            return NextResponse.json({ error: "Failed to save multisig settings" }, { status: 500 });
        }

        return NextResponse.json({
            securityMultiSigEnabled: true,
            safeAddress: safeAddress.toLowerCase(),
            safe,
            note: "Run 'Reroute' to set this Safe as your on-chain payout destination so the change takes effect.",
        });
    } catch (err: any) {
        console.error("[merchant/multisig] POST error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
