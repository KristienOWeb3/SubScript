import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { DmGameError } from "./errors";

export async function requireDmGameUser(headers: Headers) {
    const wallet = await getSessionWallet(headers);
    if (!wallet) {
        return {
            wallet: null,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
    }
    const role = await requireAccountRole(wallet, "USER");
    if (!role.ok) {
        return {
            wallet: null,
            response: NextResponse.json({ error: role.error }, { status: role.status }),
        };
    }
    return { wallet: wallet.toLowerCase(), response: null };
}

export function dmGameErrorResponse(error: unknown, operation: string) {
    if (error instanceof DmGameError) {
        return NextResponse.json(
            { error: error.message, code: error.code },
            { status: error.status },
        );
    }
    console.error(`DM game ${operation} failed:`, error);
    return NextResponse.json(
        { error: `Failed to ${operation} game` },
        { status: 500 },
    );
}

