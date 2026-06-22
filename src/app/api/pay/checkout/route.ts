import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth";
import { decryptPrivateKey } from "@/lib/crypto";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { isReceiptId } from "@/lib/arc/memo";

export const maxDuration = 120;

const USDC_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
];

const ROUTER_ABI = [
    "function depositForMerchant(address merchant, uint256 amount, string memo) external",
];

/**
 * Pay a payment link with the logged-in user's embedded SubScript wallet — no browser-wallet
 * reconnect. Signs approve + depositForMerchant server-side with the session wallet's own key
 * (same pattern as /api/execute-tx), then the client runs the existing verify pipeline on the
 * returned txHash. Only ever spends the authenticated user's own funds to the link's merchant.
 */
export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized: Sign in to pay with your SubScript account." }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const paymentLinkId = body?.paymentLinkId;
        if (!paymentLinkId || typeof paymentLinkId !== "string") {
            return NextResponse.json({ error: "paymentLinkId is required" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Circuit breaker */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("hosted_payments_enabled")
            .maybeSingle();
        if (settings && settings.hosted_payments_enabled === false) {
            return NextResponse.json({ error: "Service Unavailable: Hosted payments are temporarily disabled." }, { status: 503 });
        }

        /* Load the payment link */
        const { data: link, error: linkError } = await supabase
            .from("payment_links")
            .select("id, merchant_address, amount_usdc, receipt_token, status, active, max_uses, use_count")
            .eq("id", paymentLinkId)
            .maybeSingle();

        if (linkError || !link) {
            return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
        }
        if (link.active === false) {
            return NextResponse.json({ error: "This payment link is no longer active." }, { status: 409 });
        }
        if (link.status === "PAID") {
            return NextResponse.json({ error: "This payment link has already been paid." }, { status: 409 });
        }
        if (link.max_uses != null && (link.use_count || 0) >= link.max_uses) {
            return NextResponse.json({ error: "This payment link has reached its usage limit." }, { status: 409 });
        }
        const receiptToken = link.receipt_token;
        if (!isReceiptId(receiptToken)) {
            return NextResponse.json({ error: "This payment link is missing a valid receipt token." }, { status: 400 });
        }

        const payer = wallet.toLowerCase();
        if (link.merchant_address?.toLowerCase() === payer) {
            return NextResponse.json({ error: "You cannot pay your own payment link." }, { status: 400 });
        }

        /* Load the payer's embedded wallet key (this path is only for embedded/server-managed wallets). */
        const { data: walletRecord, error: walletErr } = await supabase
            .from("user_embedded_wallets")
            .select("encrypted_private_key, provider")
            .eq("wallet_address", payer)
            .maybeSingle();

        if (walletErr || !walletRecord) {
            return NextResponse.json({ error: "No SubScript embedded wallet found for this account." }, { status: 404 });
        }
        if (walletRecord.provider === "external_wallet" || !walletRecord.encrypted_private_key) {
            return NextResponse.json({ error: "This account uses an external wallet — pay with your connected wallet instead." }, { status: 409 });
        }

        const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key);
        const { provider } = await getRpcProviderForWrite();
        const signer = new ethers.Wallet(privateKey, provider);
        if (signer.address.toLowerCase() !== payer) {
            return NextResponse.json({ error: "Stored wallet key does not match your active session." }, { status: 409 });
        }

        const amount = BigInt(link.amount_usdc);
        const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ABI, signer);

        /* Funds check (amount only; gas is paid in USDC on Arc and needs a small additional balance). */
        const balance: bigint = await usdc.balanceOf(signer.address);
        if (balance < amount) {
            return NextResponse.json({ error: "Insufficient USDC balance to complete this payment." }, { status: 402 });
        }

        /* Approve the router if needed */
        const allowance: bigint = await usdc.allowance(signer.address, SUBSCRIPT_ROUTER_ADDRESS);
        if (allowance < amount) {
            const approveTx = await usdc.approve(SUBSCRIPT_ROUTER_ADDRESS, amount);
            await approveTx.wait();
        }

        /* Route the payment to the merchant with the receipt memo (verified later by /verify). */
        const router = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, ROUTER_ABI, signer);
        const tx = await router.depositForMerchant(link.merchant_address, amount, receiptToken);

        return NextResponse.json({
            success: true,
            txHash: tx.hash,
            payerAddress: payer,
            receiptId: receiptToken,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Account checkout failed:", error);
        const reason = error?.reason || error?.shortMessage || error?.message || "Payment failed";
        return NextResponse.json({ error: reason }, { status: 400 });
    }
}
