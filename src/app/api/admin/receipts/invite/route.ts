import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { isReceiptId } from "@/lib/arc/memo";

/* Admin-initiated receipt invite.
 *
 * Deliberately a SEPARATE route rather than an `|| isAdmin` branch inside
 * /api/receipts/invite. That route enforces a clean two-principal rule (payer or merchant),
 * and threading an admin exception through it would mean every future reader of the
 * user-facing path has to know an escape hatch exists — turning an allowlist bug into a
 * receipt-privacy bug on the path real customers use.
 *
 * A `reason` is REQUIRED here, unlike the user-facing route. This action discloses a third
 * party's payment record to an address that was never part of the transaction, so the audit
 * row needs to say why it happened, not just that it did.
 */

export async function POST(request: Request) {
    const auth = await requireScope(request, "compliance");
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const receiptId = typeof body?.receiptId === "string" ? body.receiptId.trim() : "";
        const inviteAddress = typeof body?.inviteAddress === "string" ? body.inviteAddress.trim() : "";
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

        if (!isReceiptId(receiptId)) {
            return NextResponse.json({ error: "Missing or invalid receiptId" }, { status: 400 });
        }
        if (!inviteAddress || !ethers.isAddress(inviteAddress)) {
            return NextResponse.json({ error: "Enter a valid wallet address to invite" }, { status: 400 });
        }
        if (reason.length < 3) {
            return NextResponse.json(
                { error: "A reason is required — this grants a third party access to someone's payment record." },
                { status: 400 },
            );
        }

        const receipt = await prisma.receipt.findUnique({ where: { receiptId } });
        if (!receipt) {
            return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
        }

        const inviteAddressLower = inviteAddress.toLowerCase();

        /* Append from the value locked by this UPDATE, matching /api/receipts/invite. A
           read/modify/write in application memory loses one invite when two callers race.
           The containment guard makes a repeat invite a no-op instead of a duplicate. */
        const updated = await prisma.$executeRaw`
            UPDATE receipts
            SET invited_addresses = CASE
                    WHEN invited_addresses = '' THEN ${inviteAddressLower}
                    ELSE invited_addresses || ',' || ${inviteAddressLower}
                END,
                updated_at = now()
            WHERE receipt_id = ${receiptId}
              AND NOT (string_to_array(invited_addresses, ',') @> ARRAY[${inviteAddressLower}]::text[])
        `;

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "RECEIPT_INVITE",
            target: receiptId,
            detail: {
                inviteAddress: inviteAddressLower,
                reason,
                merchantAddress: receipt.merchantAddress,
                payerAddress: receipt.payerAddress,
                alreadyInvited: updated === 0,
            },
            request,
        });

        return NextResponse.json({
            success: true,
            message: updated === 0
                ? "That address already had access to this receipt."
                : "Address invited — they can now view this receipt.",
        });
    } catch (error: any) {
        console.error("[admin/receipts/invite] failed:", error);
        return NextResponse.json({ error: "Failed to invite viewer" }, { status: 500 });
    }
}
