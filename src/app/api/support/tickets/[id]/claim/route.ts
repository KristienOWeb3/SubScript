import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/guard";
import {
    getSupportTicketWithMessages,
    updateSupportTicketStatus,
    type SupportTicketStatus,
} from "@/lib/support/tickets";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireAdmin(request);
        if (!auth.ok) return auth.response;

        const { id: ticketId } = await params;
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || "").toUpperCase(); // RESOLVE, CLOSE, REOPEN

        let targetStatus: SupportTicketStatus = "RESOLVED";
        if (action === "CLOSE") targetStatus = "CLOSED";
        else if (action === "REOPEN") targetStatus = "OPEN";
        else if (action === "RESOLVE") targetStatus = "RESOLVED";

        const result = await updateSupportTicketStatus(ticketId, targetStatus, auth.admin.wallet);
        if (!result.ok) {
            return NextResponse.json({ error: result.error || "Failed to update ticket" }, { status: 400 });
        }

        const ticket = await getSupportTicketWithMessages(ticketId);
        return NextResponse.json({ success: true, ticket });
    } catch (error: any) {
        console.error("[api/support/tickets/[id]/claim] POST failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to update ticket" }, { status: 500 });
    }
}
