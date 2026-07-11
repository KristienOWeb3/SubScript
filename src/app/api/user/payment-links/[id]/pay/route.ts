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

        /* Both settlement paths need a valid receipt token downstream in /verify (the merchant path
           uses it as the on-chain memo; the peer path still requires one for the receipt record), so
           validate it BEFORE moving any funds rather than transferring and only failing at verify. */
        if (!isReceiptId(link.receiptToken)) {
            return NextResponse.json(
                { error: "This checkout is missing a valid receipt token. Ask the merchant to regenerate the link." },
                { status: 400 },
            );
        }
        const receiptToken = link.receiptToken as string;

        /* Single-flight guard: two concurrent POSTs (double-click, two tabs) would otherwise both pass
           the read-only guards above and sign SEPARATE custody transfers — a double charge. Atomically
           claim the (link, payer) pair via the unique idempotency key: a concurrent attempt gets 409,
           and an already-completed one returns the original tx hash instead of paying again. */
        const claimKey = `embedded-pay:${id}:${payer}`;
        const claimExpiry = () => new Date(Date.now() + 5 * 60 * 1000);
        try {
            await prisma.idempotencyKey.create({
                data: { executionKey: claimKey, status: "PROCESSING", expiresAt: claimExpiry() },
            });
        } catch (e: any) {
            if (e?.code === "P2002") {
                const existing = await prisma.idempotencyKey.findUnique({ where: { executionKey: claimKey } }).catch(() => null);
                const priorTx = (existing?.responsePayload as any)?.txHash;
                if (existing?.status === "COMPLETED" && priorTx) {
                    return NextResponse.json({ success: true, txHash: priorTx, receiptId: receiptToken, settlesDirectlyToUser }, { status: 200 });
                }
                /* A PROCESSING claim whose expiry has passed is an abandoned lock — a previous request
                   crashed or timed out after create() but before completing. Atomically re-claim it
                   (guarded on the still-expired state so it can't steal a live claim) and continue;
                   otherwise a genuine in-flight request is holding it. */
                const isReclaimable = existing?.status === "PROCESSING" && existing?.expiresAt && new Date(existing.expiresAt) < new Date();
                if (isReclaimable) {
                    const reclaimed = await prisma.idempotencyKey.updateMany({
                        where: { executionKey: claimKey, status: "PROCESSING", expiresAt: { lt: new Date() } },
                        data: { expiresAt: claimExpiry(), responsePayload: undefined },
                    });
                    if (reclaimed.count === 0) {
                        /* Another request re-claimed it first. */
                        return NextResponse.json({ error: "A payment for this link is already in progress." }, { status: 409 });
                    }
                } else {
                    return NextResponse.json({ error: "A payment for this link is already in progress." }, { status: 409 });
                }
            } else {
                throw e;
            }
        }

        let txHash: string;
        try {
            txHash = settlesDirectlyToUser
                ? await payPeerLinkFromEmbedded(payer, recipient, amountMicros)
                : await payMerchantLinkFromEmbedded(payer, recipient, amountMicros, receiptToken);
        } catch (err: any) {
            /* Release the claim so a failed payment can be retried immediately. */
            await prisma.idempotencyKey.delete({ where: { executionKey: claimKey } }).catch(() => {});
            const message = err?.message || "Payment could not be signed from your SubScript wallet.";
            /* getWalletCustody throws for wallets with no server-held key (external/browser wallets). */
            const status = /no server-held key|connect a browser wallet/i.test(message) ? 400
                : /insufficient|balance|exceeds/i.test(message) ? 402
                : 502;
            return NextResponse.json({ error: message }, { status });
        }

        /* Mark the claim COMPLETED with the tx hash so an accidental re-submit returns it idempotently. */
        await prisma.idempotencyKey.update({
            where: { executionKey: claimKey },
            data: { status: "COMPLETED", responsePayload: { txHash } },
        }).catch(() => {});

        return NextResponse.json({
            success: true,
            txHash,
            receiptId: receiptToken,
            settlesDirectlyToUser,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Embedded payment-link pay failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
