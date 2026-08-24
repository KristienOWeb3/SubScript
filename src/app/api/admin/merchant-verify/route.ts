import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/admin/guard";
import { requestIp } from "@/lib/admin/audit";
import { jsonOk } from "@/lib/http/json";
import { withAdminDbRetry } from "@/lib/admin/db";

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
    const auth = await requireScope(request, "support");
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.merchantAddress !== "string" || typeof body.verified !== "boolean") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    let merchantAddress = body.merchantAddress.trim().toLowerCase();

    // Support DNS alias lookup (e.g. acme.sub)
    if (merchantAddress.includes(".") && !/^0x[a-f0-9]{40}$/.test(merchantAddress)) {
      const aliasRow = await withAdminDbRetry(() => prisma.addressAlias.findUnique({
        where: { alias: merchantAddress },
        select: { address: true },
      }));
      if (aliasRow?.address) {
        merchantAddress = aliasRow.address.toLowerCase();
      }
    }

    if (!/^0x[a-f0-9]{40}$/.test(merchantAddress)) {
      return NextResponse.json({ error: "Enter a valid merchant wallet address or SubScript DNS name." }, { status: 400 });
    }
    const verified = body.verified;

    const updated = await withAdminDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const account = await tx.accountRole.findUnique({
          where: { address: merchantAddress },
          select: { role: true },
        });
        if (!account || account.role !== "ENTERPRISE") {
          const error = new Error("That wallet is not an enterprise merchant account.");
          (error as Error & { status?: number }).status = 409;
          throw error;
        }

        const row = await tx.merchant.update({
          where: { walletAddress: merchantAddress },
          data: { verified },
          select: MERCHANT_SELECT,
        });
        await tx.adminAuditLog.create({
          data: {
            actor: auth.admin.wallet,
            action: "MERCHANT_VERIFY",
            target: merchantAddress,
            detail: { verified },
            ip: requestIp(request),
          },
        });
        return row;
      }),
    );

    return jsonOk({ success: true, merchant: updated });
  } catch (err: any) {
    console.error("Failed to update merchant verification:", err);
    const status = Number.isInteger(err?.status) ? err.status : err?.code === "P2025" ? 404 : 500;
    const error = status === 404 ? "Merchant account not found."
      : status === 409 ? err.message
      : "Failed to update merchant verification.";
    return NextResponse.json({ error }, { status });
  }
}
