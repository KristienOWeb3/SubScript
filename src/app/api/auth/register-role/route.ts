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

        /* Check if role is already registered for this wallet */
        const existingRole = await prisma.accountRole.findUnique({
            where: { address: wallet.toLowerCase() }
        });

        if (existingRole) {
            if (existingRole.role !== role) {
                return NextResponse.json({
                    error: `This wallet is already registered as ${existingRole.role}. Use a different wallet for ${role}.`,
                    role: existingRole.role,
                }, { status: 409 });
            }
            return NextResponse.json({ success: true, role: existingRole.role, message: "Role already registered for this wallet" }, { status: 200 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const accountRole = await prisma.$transaction(async (tx) => {
            const createdRole = await tx.accountRole.create({
                data: {
                    address: normalizedWallet,
                    role,
                }
            });

            if (role === "ENTERPRISE") {
                await tx.customer.deleteMany({ where: { walletAddress: normalizedWallet } });
                await tx.merchant.upsert({
                    where: { walletAddress: normalizedWallet },
                    update: {},
                    create: {
                        walletAddress: normalizedWallet,
                        tier: "FREE",
                        availableBalanceUsdc: BigInt(0),
                        reservedBalanceUsdc: BigInt(0),
                    }
                });
            } else {
                await tx.merchant.deleteMany({ where: { walletAddress: normalizedWallet } });
                await tx.customer.upsert({
                    where: { walletAddress: normalizedWallet },
                    update: {},
                    create: {
                        walletAddress: normalizedWallet,
                    }
                });
            }

            return createdRole;
        });

        return NextResponse.json({ success: true, role: accountRole.role }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to register role:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
