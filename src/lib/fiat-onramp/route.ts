import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { FiatOnrampError } from "./errors";

export async function requireFundingUser(headers: Headers) {
    const wallet = await getSessionWallet(headers);
    if (!wallet) {
        return {
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
            wallet: null,
        };
    }

    const roleCheck = await requireAccountRole(wallet, "USER");
    if (!roleCheck.ok) {
        return {
            response: NextResponse.json(
                { error: roleCheck.error },
                { status: roleCheck.status },
            ),
            wallet: null,
        };
    }

    return { response: null, wallet: wallet.toLowerCase() };
}

export function fundingErrorResponse(error: unknown, operation: string) {
    if (error instanceof FiatOnrampError) {
        return NextResponse.json(
            { error: error.message, code: error.code },
            { status: error.status },
        );
    }

    console.error(`Fiat onramp ${operation} failed:`, error);
    return NextResponse.json(
        { error: `Failed to ${operation} funding intent` },
        { status: 500 },
    );
}
