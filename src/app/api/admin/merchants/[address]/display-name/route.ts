import { NextResponse } from "next/server";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";
import { sanitizeDisplayName } from "@/lib/merchants/identity";

/* Admin-governed merchant display name.
 *
 * Admins have full authority to set or correct any merchant's business display name at any time.
 * Setting it also locks it (display_name_locked = true), so the merchant cannot self-edit it —
 * every subsequent change goes through an admin here. Each edit is recorded in admin_audit_log
 * with the previous and new value. Merchant IDs are immutable and are never touched here. */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ address: string }> }
) {
    const auth = await requireScope(request, "support");
    if (!auth.ok) return auth.response;

    const { address } = await params;
    if (!address || !ethers.isAddress(address)) {
        return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
    }
    const normalizedAddress = address.toLowerCase();

    try {
        const body = await request.json().catch(() => ({}));
        const displayName = sanitizeDisplayName(body?.displayName);
        if (!displayName) {
            return NextResponse.json({ error: "Enter a display name." }, { status: 400 });
        }

        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: normalizedAddress },
            select: { displayName: true },
        });
        if (!merchant) {
            return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
        }

        const previous = merchant.displayName;
        const updated = await prisma.merchant.update({
            where: { walletAddress: normalizedAddress },
            data: { displayName, displayNameLocked: true },
            select: { merchantId: true, displayName: true, displayNameLocked: true },
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "MERCHANT_DISPLAY_NAME_SET",
            target: normalizedAddress,
            detail: { previous, next: displayName },
            request,
        });

        return NextResponse.json({ success: true, merchant: updated });
    } catch (error: any) {
        console.error(`[admin/merchants/${normalizedAddress}/display-name] error:`, error);
        return NextResponse.json({ error: error.message || "Failed to update display name" }, { status: 500 });
    }
}
