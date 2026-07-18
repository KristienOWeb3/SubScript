import { NextResponse } from "next/server";

/*
 * Retired. This endpoint authenticated a wallet from a signature over a bare timestamp inside a
 * 5-minute window — with no server-issued, single-use nonce, that same signature was replayable
 * for the whole window. It has no callers: the developer-portal "Authenticate" flow signs a
 * server-issued nonce and posts to /api/auth/verify-signature (single-use, cleared on redeem).
 *
 * Rather than maintain a weaker parallel auth path, we fail closed and point callers at the nonce
 * flow. Returns 410 Gone so any lingering integration surfaces loudly instead of silently relying
 * on a replayable signature.
 */
export async function POST() {
    return NextResponse.json(
        {
            error: "This login endpoint has been retired. Use the nonce-based flow: GET /api/auth/nonce, sign the returned nonce, then POST to /api/auth/verify-signature.",
            code: "AUTH_LOGIN_RETIRED",
        },
        { status: 410 }
    );
}
