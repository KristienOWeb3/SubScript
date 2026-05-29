import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";

// GET /api/webhooks/events - Retrieve last 50 webhook events for current wallet
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const events = await prisma.webhookEvent.findMany({
            where: {
                endpoint: {
                    walletAddress: wallet.toLowerCase(),
                },
            },
            include: {
                endpoint: {
                    select: {
                        url: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 50,
        });

        // Map database events to frontend structure
        const mappedEvents = events.map(e => ({
            id: e.id,
            event: e.event,
            status: e.status,
            time: e.createdAt.toLocaleString(),
            endpointUrl: e.endpoint.url,
            payload: e.payload,
            responseBody: e.responseBody,
        }));

        return NextResponse.json({ events: mappedEvents }, { status: 200 });
    } catch (error) {
        console.error("GET webhook events error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
