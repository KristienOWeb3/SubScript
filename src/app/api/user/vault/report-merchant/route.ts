/* A user reports a commit (metered-vault) merchant for suspected abuse — e.g. billing for usage
   they didn't incur. Reports are recorded for SubScript ops review and feed merchant reputation;
   they deliberately do NOT touch the keeper draw (a user-blockable draw would be trivially abused
   to reclaim escrow after consuming the service). Only a user who actually holds a vault with the
   merchant can report, and only once (per merchant) at a time. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const { merchantAddress, reason, detail } = body;
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 120) : "";
        if (!cleanReason) {
            return NextResponse.json({ error: "A reason is required to report a merchant." }, { status: 400 });
        }
        const cleanDetail = typeof detail === "string" && detail.trim() ? detail.trim().slice(0, 1000) : null;

        const reporter = wallet.toLowerCase();
        const merchant = merchantAddress.toLowerCase();
        if (reporter === merchant) {
            return NextResponse.json({ error: "You can't report yourself." }, { status: 400 });
        }

        /* Only commit merchants can be reported, and only by a user who actually committed to them:
           a vault row proves the relationship and scopes reports to the metered-billing surface. */
        const vault = await prisma.meteredVault.findUnique({
            where: { userAddress_merchantAddress: { userAddress: reporter, merchantAddress: merchant } },
            select: { id: true },
        });
        if (!vault) {
            return NextResponse.json(
                { error: "You can only report a merchant you've committed a vault to." },
                { status: 403 },
            );
        }

        try {
            const report = await prisma.merchantReport.create({
                data: { merchantAddress: merchant, reporterAddress: reporter, reason: cleanReason, detail: cleanDetail },
            });
            return NextResponse.json({ success: true, reportId: report.id, status: report.status }, { status: 201 });
        } catch (e: any) {
            /* Unique (merchant, reporter): one open report per user at a time. */
            if (e?.code === "P2002") {
                return NextResponse.json(
                    { error: "You've already reported this merchant. Our team is reviewing it." },
                    { status: 409 },
                );
            }
            throw e;
        }
    } catch (err: any) {
        console.error("Merchant report failed:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
