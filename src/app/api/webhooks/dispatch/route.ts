import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWebhookRequest } from "@/lib/webhooks";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        // 1. Authenticate the caller (the keeper bot)
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET || "default_keeper_secret_temp_123";
        
        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const { walletAddress, event, data } = body;

        if (!walletAddress || !event || !data) {
            return NextResponse.json(
                { error: "walletAddress, event, and data are required" },
                { status: 400 }
            );
        }

        const normalizedWallet = walletAddress.toLowerCase();

        // 2. Fetch active webhook endpoints for this merchant
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: {
                walletAddress: normalizedWallet,
                active: true,
            },
        });

        if (endpoints.length === 0) {
            return NextResponse.json({
                success: true,
                message: "No active webhook endpoints registered for this wallet.",
                dispatchedCount: 0,
            });
        }

        // 3. Compile webhook payload (Standard format)
        const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`;
        const webhookPayload = {
            id: eventId,
            event,
            created: Math.floor(Date.now() / 1000),
            data,
        };

        // 4. Dispatch to all active endpoints
        const deliveryPromises = endpoints.map(async (endpoint) => {
            const { status, responseText } = await sendWebhookRequest(
                endpoint.url,
                webhookPayload,
                endpoint.secret
            );

            // Log attempt in the database
            return prisma.webhookEvent.create({
                data: {
                    id: eventId,
                    webhookEndpointId: endpoint.id,
                    event,
                    status,
                    payload: webhookPayload as any,
                    responseBody: responseText,
                },
            });
        });

        await Promise.all(deliveryPromises);

        return NextResponse.json({
            success: true,
            message: `Dispatched to ${endpoints.length} webhook endpoint(s).`,
            dispatchedCount: endpoints.length,
            eventId,
        });
    } catch (error: any) {
        console.error("Webhook dispatch error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
