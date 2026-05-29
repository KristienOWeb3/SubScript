import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import crypto from "crypto";

// GET /api/webhooks/endpoints - List registered webhook endpoints
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const endpoints = await prisma.webhookEndpoint.findMany({
            where: {
                walletAddress: wallet.toLowerCase(),
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return NextResponse.json({ endpoints }, { status: 200 });
    } catch (error) {
        console.error("GET webhook endpoints error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST /api/webhooks/endpoints - Register a new webhook endpoint
export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !body.url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const { url } = body;

        // Simple validation for URL format
        try {
            new URL(url);
        } catch (_) {
            return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
        }

        // Generate webhook signing secret
        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

        const endpoint = await prisma.webhookEndpoint.create({
            data: {
                walletAddress: wallet.toLowerCase(),
                url,
                secret,
            },
        });

        return NextResponse.json({ endpoint }, { status: 201 });
    } catch (error) {
        console.error("POST webhook endpoint error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE /api/webhooks/endpoints - Delete a registered webhook endpoint
export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Missing endpoint ID" }, { status: 400 });
        }

        // Ensure endpoint belongs to the authenticated wallet
        const endpoint = await prisma.webhookEndpoint.findFirst({
            where: {
                id,
                walletAddress: wallet.toLowerCase(),
            },
        });

        if (!endpoint) {
            return NextResponse.json({ error: "Endpoint not found or access denied" }, { status: 404 });
        }

        // Delete endpoint (and cascade events via onDelete constraint)
        await prisma.webhookEndpoint.delete({
            where: { id },
        });

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error("DELETE webhook endpoint error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
