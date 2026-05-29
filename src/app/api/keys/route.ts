import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import crypto from "crypto";

// GET /api/keys - List active API keys for the current wallet
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const keys = await prisma.apiKey.findMany({
            where: {
                walletAddress: wallet.toLowerCase(),
                revoked: false,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return NextResponse.json({ keys }, { status: 200 });
    } catch (error) {
        console.error("GET API keys error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST /api/keys - Generate a new API key pair and revoke old ones
export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const walletLower = wallet.toLowerCase();

        // 1. Revoke existing keys for this wallet address
        await prisma.apiKey.updateMany({
            where: {
                walletAddress: walletLower,
                revoked: false,
            },
            data: {
                revoked: true,
            },
        });

        // 2. Generate new key pair
        // Publishable key (hex length 24 => 48 chars prefix pk_test_)
        const publishableKey = `pk_test_${crypto.randomBytes(24).toString("hex")}`;
        // Secret key (hex length 32 => 64 chars prefix sk_test_)
        const secretKeyPlain = `sk_test_${crypto.randomBytes(32).toString("hex")}`;

        const newKey = await prisma.apiKey.create({
            data: {
                walletAddress: walletLower,
                publishableKey,
                secretKeyPlain,
                revoked: false,
            },
        });

        return NextResponse.json({ key: newKey }, { status: 201 });
    } catch (error) {
        console.error("POST API keys error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE /api/keys - Revoke a specific API key
export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Missing key ID" }, { status: 400 });
        }

        // Find the key to ensure it belongs to the authenticated wallet
        const key = await prisma.apiKey.findFirst({
            where: {
                id,
                walletAddress: wallet.toLowerCase(),
            },
        });

        if (!key) {
            return NextResponse.json({ error: "API Key not found or access denied" }, { status: 404 });
        }

        // Revoke the key
        const updatedKey = await prisma.apiKey.update({
            where: { id },
            data: { revoked: true },
        });

        return NextResponse.json({ success: true, key: updatedKey }, { status: 200 });
    } catch (error) {
        console.error("DELETE API keys error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
