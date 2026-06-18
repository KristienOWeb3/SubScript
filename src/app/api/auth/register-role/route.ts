/* API route to register or update account role (USER or ENTERPRISE) for authenticated wallets */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { role } = sanitizedBody;

        if (role !== "USER" && role !== "ENTERPRISE") {
            return NextResponse.json({ error: "Invalid role selected" }, { status: 400 });
        }

        /* Upsert the role in the account_roles table */
        const accountRole = await prisma.accountRole.upsert({
            where: { address: wallet.toLowerCase() },
            update: { role },
            create: {
                address: wallet.toLowerCase(),
                role,
            }
        });

        /* If Enterprise, ensure a default Merchant entry exists. If User, ensure a Customer entry exists. */
        if (role === "ENTERPRISE") {
            await prisma.merchant.upsert({
                where: { walletAddress: wallet.toLowerCase() },
                update: {},
                create: {
                    walletAddress: wallet.toLowerCase(),
                    tier: "FREE",
                    availableBalanceUsdc: BigInt(0),
                    reservedBalanceUsdc: BigInt(0),
                }
            });
        } else {
            await prisma.customer.upsert({
                where: { walletAddress: wallet.toLowerCase() },
                update: {},
                create: {
                    walletAddress: wallet.toLowerCase(),
                }
            });
        }

        return NextResponse.json({ success: true, role: accountRole.role }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to register role:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
