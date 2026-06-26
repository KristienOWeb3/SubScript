/* Capture an email for the logged-in user's customer profile.
   Used by the "add your email" prompt that wallet-onboarded users see (auto-created
   accounts have no email yet, and email is required for receipts/notifications). */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

        const body = sanitizeInput(await request.json().catch(() => null));
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
        }

        await prisma.customer.upsert({
            where: { walletAddress: wallet.toLowerCase() },
            update: { email },
            create: { walletAddress: wallet.toLowerCase(), email },
        });

        /* Wallet-onboarded users: their registered email name becomes their default .sub username
           (only if they don't already have one; changeable later). */
        await ensureDefaultAliasFromEmail(wallet, email);

        return NextResponse.json({ success: true, email }, { status: 200 });
    } catch (error: any) {
        console.error("Failed to save user email:", error);
        return NextResponse.json({ error: error.message || "Failed to save email" }, { status: 500 });
    }
}
