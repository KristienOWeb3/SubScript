/* On-page checkout for logged-in embedded (custody) wallet users. Signs the SAME on-chain payment
   a browser wallet would make on /pay/[id], server-side, so Google/email users can pay a merchant
   link (or peer request) without being bounced through DMs. Returns the confirmed tx hash; the
   client then runs the standard /api/payment-links/verify + status stream, so settlement, receipts,
   and merchant webhooks are entirely unchanged. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { isReceiptId } from "@/lib/arc/memo";
import { payMerchantLinkFromEmbedded, payPeerLinkFromEmbedded } from "@/lib/paymentLinks/embeddedPay";

type RouteContext = {
    params: Promise<{ id: string }>;
};

function isPeerRequestLink(link: { merchantNameSnapshot: string | null; externalReference: string | null }) {
    return link.merchantNameSnapshot === "SubScript user request" ||
        (typeof link.externalReference === "string" &&
            (link.externalReference.startsWith("peer-request:") || link.externalReference.startsWith("dm-peer-request:")));
}

export async function POST(request: Request, { params }: RouteContext) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const role = await resolveAccountRoleWithBackfill(wallet);
        if (role !== "USER") {
            return NextResponse.json({
                error: role === "ENTERPRISE"
                    ? "Merchant accounts can't pay checkout links."
                    : "Unable to verify your account. Please try again.",
            }, { status: role === "ENTERPRISE" ? 403 : 500 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing payment link id" }, { status: 400 });
        }

        const link = await prisma.paymentLink.findUnique({ where: { id } });
        if (!link) {
            return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
        }

        /* Settlement-parity guards with the hosted verifier: never let an inactive, expired, or
           exhausted link mint a fresh on-chain charge. */
        if (link.active === false || link.status === "PAID") {
            return NextResponse.json({ error: "This payment link is no longer active." }, { status: 410 });
        }
        if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
            return NextResponse.json({ error: "This payment link has expired." }, { status: 410 });
        }
        if (link.maxUses !== null && link.maxUses !== undefined && (link.useCount || 0) >= link.maxUses) {
            return NextResponse.json({ error: "This payment link has reached its usage limit." }, { status: 409 });
        }

        const amountMicros = BigInt(link.amountUsdc);
        if (amountMicros <= BigInt(0)) {
            return NextResponse.json({ error: "This payment link has an invalid amount." }, { status: 400 });
        }

        const payer = wallet.toLowerCase();
        const recipient = link.merchantAddress.toLowerCase();
        if (payer === recipient) {
            return NextResponse.json({ error: "You can't pay your own payment link." }, { status: 400 });
        }

        const settlesDirectlyToUser = isPeerRequestLink(link);

        let txHash: string;
        try {
            if (settlesDirectlyToUser) {
                txHash = await payPeerLinkFromEmbedded(payer, recipient, amountMicros);
            } else {
                if (!isReceiptId(link.receiptToken)) {
                    return NextResponse.json(
                        { error: "This checkout is missing a valid receipt token. Ask the merchant to regenerate the link." },
                        { status: 400 },
                    );
                }
                txHash = await payMerchantLinkFromEmbedded(payer, recipient, amountMicros, link.receiptToken as string);
            }
        } catch (err: any) {
            const message = err?.message || "Payment could not be signed from your SubScript wallet.";
            /* getWalletCustody throws for wallets with no server-held key (external/browser wallets). */
            const status = /no server-held key|connect a browser wallet/i.test(message) ? 400
                : /insufficient|balance|exceeds/i.test(message) ? 402
                : 502;
            return NextResponse.json({ error: message }, { status });
        }

        return NextResponse.json({
            success: true,
            txHash,
            receiptId: isReceiptId(link.receiptToken) ? link.receiptToken : null,
            settlesDirectlyToUser,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Embedded payment-link pay failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
