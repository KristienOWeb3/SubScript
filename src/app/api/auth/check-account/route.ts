import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { email, address } = sanitizeInput(body);

        if (email) {
            const emailLower = email.toLowerCase().trim();
            const wallet = await prisma.userEmbeddedWallet.findUnique({
                where: { email: emailLower }
            });
            if (wallet) {
                const roleRecord = await prisma.accountRole.findUnique({
                    where: { address: wallet.walletAddress.toLowerCase() }
                });
                if (roleRecord) {
                    return NextResponse.json({ exists: true, wallet: wallet.walletAddress, role: roleRecord.role });
                }
            }
            return NextResponse.json({ exists: false });
        }

        if (address) {
            const addressLower = address.toLowerCase().trim();
            const roleRecord = await prisma.accountRole.findUnique({
                where: { address: addressLower }
            });
            if (roleRecord) {
                return NextResponse.json({ exists: true, wallet: addressLower, role: roleRecord.role });
            }
            return NextResponse.json({ exists: false });
        }

        return NextResponse.json({ error: "Missing email or address parameter" }, { status: 400 });
    } catch (err: any) {
        console.error("Check account error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
