import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.merchantAddress !== "string") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    /* Lowercase to match how merchants are stored. Every other lookup normalizes
       (overview/route.ts, payment-links/[id]/route.ts); passing a checksummed address
       straight through misses the row and surfaces as a P2025 500. */
    const merchantAddress = body.merchantAddress.trim().toLowerCase();
    const verified = Boolean(body.verified);

    const updated = await prisma.merchant.update({
      where: { walletAddress: merchantAddress },
      data: { verified },
    });

    await recordAdminAction({
      actor: auth.admin.wallet,
      action: "MERCHANT_VERIFY",
      target: merchantAddress,
      detail: { verified },
      request,
    });

    return NextResponse.json({ success: true, merchant: updated });
  } catch (err: any) {
    console.error("Failed to update merchant verification:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
