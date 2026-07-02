import { NextResponse } from "next/server";
import { requireDmGameUser, dmGameErrorResponse } from "@/lib/games/route";
import { getDmGamesConfig } from "@/lib/games/config";
import { parseGameStakeToMicros } from "@/lib/games/money";
import { createDmGame } from "@/lib/games/service";
import { enforceDmGameRateLimit } from "@/lib/games/rate-limit";
import { sanitizeInput } from "@/utils/security";

export async function POST(request: Request) {
    try {
        const { wallet, response } = await requireDmGameUser(request.headers);
        if (response) return response;

        await enforceDmGameRateLimit(wallet!, "create");

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitized = sanitizeInput(body);
        const { opponentAddress, stakeUsdc, gameType } = sanitized;

        const config = getDmGamesConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: config.unavailableReason || "Games are disabled" }, { status: 503 });
        }

        const stakeMicros = parseGameStakeToMicros(stakeUsdc);

        const game = await createDmGame({
            creatorAddress: wallet!,
            opponentAddress: opponentAddress || null,
            stakePerPlayerUsdc: stakeMicros,
            gameType: typeof gameType === "string" ? gameType : undefined,
            config,
        });

        // Format BigInt values as strings for JSON response
        const formattedGame = {
            ...game,
            stakePerPlayerUsdc: game.stakePerPlayerUsdc.toString(),
        };

        return NextResponse.json({ success: true, game: formattedGame }, { status: 201 });
    } catch (error) {
        return dmGameErrorResponse(error, "create");
    }
}
