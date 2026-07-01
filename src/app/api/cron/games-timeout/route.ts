import { NextResponse } from "next/server";
import { settleExpiredDmGames } from "@/lib/games/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request) {
    const keeperSecret = process.env.KEEPER_SECRET;
    const cronSecret = process.env.CRON_SECRET;
    if (!keeperSecret && !cronSecret) return null;

    const authorization = request.headers.get("authorization");
    const presented = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;

    return Boolean(
        presented
        && (
            (keeperSecret && presented === keeperSecret)
            || (cronSecret && presented === cronSecret)
        )
    );
}

async function settleExpiredGames(request: Request) {
    try {
        const authorized = isAuthorized(request);
        if (authorized === null) {
            return NextResponse.json(
                { error: "Internal Server Error: KEEPER_SECRET or CRON_SECRET must be configured" },
                { status: 500 },
            );
        }
        if (!authorized) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const settled = await settleExpiredDmGames(new Date(), 100);
        return NextResponse.json({
            success: true,
            processed: settled.length,
            gameIds: settled.map((game) => game.id),
        });
    } catch (error) {
        console.error("Failed to settle expired DM games:", error);
        return NextResponse.json(
            { error: "Failed to settle expired games" },
            { status: 500 },
        );
    }
}

export async function GET(request: Request) {
    return settleExpiredGames(request);
}

export async function POST(request: Request) {
    return settleExpiredGames(request);
}
