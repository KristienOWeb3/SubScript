import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { jsonOk } from "@/lib/http/json";

/* Manual merchant verification — the badge payers are shown at checkout.
 *
 * The response is a NARROW projection, not the updated row. `merchants` carries
 * available_balance_usdc and reserved_balance_usdc as BigInt, and echoing the whole row put
 * them through JSON.stringify, which throws on BigInt: the update committed and the operator
 * still saw "Do not know how to serialize a BigInt" as a 500. Selecting only what the console
 * renders fixes the crash and keeps merchant balances — which this screen has no use for —
 * out of the response entirely. jsonOk is the backstop if a BigInt column is ever added to
 * this select by mistake.
 */

const MERCHANT_SELECT = {
  walletAddress: true,
  tier: true,
  verified: true,
  profilePic: true,
  createdAt: true,
} as const;

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
      select: MERCHANT_SELECT,
    });

    await recordAdminAction({
      actor: auth.admin.wallet,
      action: "MERCHANT_VERIFY",
      target: merchantAddress,
      detail: { verified },
      request,
    });

    return jsonOk({ success: true, merchant: updated });
  } catch (err: any) {
    /* No merchants row for that address. Prisma's own message names the model and the
       constraint, which is noise to an operator who just wants to know the address was
       wrong — and leaking schema detail into the console is gratuitous. */
    if (err?.code === "P2025") {
      return NextResponse.json(
        { error: "No merchant account exists for that address." },
        { status: 404 },
      );
    }
    console.error("Failed to update merchant verification:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
