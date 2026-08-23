import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseConfidentialMemoPayload } from "@/lib/arc/memo";

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please sign in with your wallet." }, { status: 401 });
        }
        const normalizedCaller = walletAddress.toLowerCase();

        const url = new URL(request.url);
        const txHash = url.searchParams.get("txHash")?.trim();

        if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid txHash parameter" }, { status: 400 });
        }

        const normalizedTx = txHash.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database connection unavailable." }, { status: 500 });
        }

        /* 1. Primary lookup in receipts table */
        const { data: receipt, error: receiptError } = await supabaseAdmin
            .from("receipts")
            .select("*")
            .eq("tx_hash", normalizedTx)
            .maybeSingle();

        if (receiptError) {
            console.error(`[tx-lookup] Database query error for ${normalizedTx}:`, receiptError.message);
            return NextResponse.json({ error: "Database query error" }, { status: 500 });
        }

        if (receipt) {
            const isPayer = receipt.payer_address?.toLowerCase() === normalizedCaller;
            const isMerchant = receipt.merchant_address?.toLowerCase() === normalizedCaller;
            const isBeneficiary = receipt.beneficiary_address?.toLowerCase() === normalizedCaller;

            // Check if caller is admin
            const { data: adminRecord } = await supabaseAdmin
                .from("admin_wallets")
                .select("wallet")
                .eq("wallet", normalizedCaller)
                .maybeSingle();

            const isAdmin = !!adminRecord;

            if (!isPayer && !isMerchant && !isBeneficiary && !isAdmin) {
                return NextResponse.json({ error: "Forbidden: You are not authorized to view this transaction." }, { status: 403 });
            }

            const parsedMemo = parseConfidentialMemoPayload(receipt.memo_note);

            return NextResponse.json({
                found: true,
                source: "receipts",
                receipt: {
                    receiptId: receipt.receipt_id,
                    txHash: receipt.tx_hash,
                    chainId: receipt.chain_id,
                    payerAddress: receipt.payer_address,
                    merchantAddress: receipt.merchant_address,
                    beneficiaryAddress: receipt.beneficiary_address,
                    amountUsdc: receipt.amount_usdc,
                    title: receipt.title || "SubScript Transaction",
                    shareUrl: receipt.share_url,
                    status: receipt.status,
                    confirmedAt: receipt.confirmed_at,
                    isShielded: parsedMemo.isShielded,
                    merchantViewKeyHashRef: parsedMemo.merchantViewKeyHashRef,
                },
            }, { status: 200 });
        }

        /* 2. Fallback lookup in payment_link_payments */
        const { data: linkPayment, error: paymentError } = await supabaseAdmin
            .from("payment_link_payments")
            .select("*, payment_links(title)")
            .eq("tx_hash", normalizedTx)
            .maybeSingle();

        if (paymentError) {
            console.error(`[tx-lookup] Payment link query error for ${normalizedTx}:`, paymentError.message);
        }

        if (linkPayment) {
            const isPayer = linkPayment.payer_address?.toLowerCase() === normalizedCaller;
            const isMerchant = linkPayment.merchant_address?.toLowerCase() === normalizedCaller;
            const isBeneficiary = linkPayment.beneficiary_address?.toLowerCase() === normalizedCaller;

            const { data: adminRecord } = await supabaseAdmin
                .from("admin_wallets")
                .select("wallet")
                .eq("wallet", normalizedCaller)
                .maybeSingle();

            const isAdmin = !!adminRecord;

            if (!isPayer && !isMerchant && !isBeneficiary && !isAdmin) {
                return NextResponse.json({ error: "Forbidden: You are not authorized to view this transaction." }, { status: 403 });
            }

            return NextResponse.json({
                found: true,
                source: "payment_link_payments",
                payment: {
                    id: linkPayment.id,
                    paymentLinkId: linkPayment.payment_link_id,
                    txHash: linkPayment.tx_hash,
                    payerAddress: linkPayment.payer_address,
                    merchantAddress: linkPayment.merchant_address,
                    beneficiaryAddress: linkPayment.beneficiary_address,
                    amountUsdc: linkPayment.amount_usdc,
                    credited: linkPayment.credited,
                    creditedAt: linkPayment.credited_at,
                    createdAt: linkPayment.created_at,
                    title: linkPayment.payment_links?.title || "Payment Link Settlement",
                },
            }, { status: 200 });
        }

        /* 3. Fallback lookup in subscriptions */
        const { data: subscription } = await supabaseAdmin
            .from("subscriptions")
            .select("subscription_id, merchant_address, subscriber, amount_cap_usdc, status, created_at")
            .eq("payment_tx_hash", normalizedTx)
            .maybeSingle();

        if (subscription) {
            const isSubscriber = subscription.subscriber?.toLowerCase() === normalizedCaller;
            const isMerchant = subscription.merchant_address?.toLowerCase() === normalizedCaller;

            if (isSubscriber || isMerchant) {
                return NextResponse.json({
                    found: true,
                    source: "subscriptions",
                    subscription: {
                        subscriptionId: subscription.subscription_id?.toString(),
                        merchantAddress: subscription.merchant_address,
                        subscriberAddress: subscription.subscriber,
                        amountCapUsdc: subscription.amount_cap_usdc,
                        status: subscription.status,
                        createdAt: subscription.created_at,
                    },
                }, { status: 200 });
            }
        }

        return NextResponse.json({
            found: false,
            message: "No recorded transaction found matching this hash. If this payment was recently submitted, please allow a few moments for verification.",
        }, { status: 404 });

    } catch (err: any) {
        console.error("Transaction lookup API error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
