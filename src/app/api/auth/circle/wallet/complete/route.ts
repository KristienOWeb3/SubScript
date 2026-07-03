import { NextResponse } from "next/server";

/*
 * Disabled until Circle identity is verified server-side and bound to a single-use login
 * challenge. The browser-provided OAuth payload is not proof of identity: trusting its email
 * would allow an attacker to mint a session for another account.
 */
export async function POST() {
    return NextResponse.json({
        error: "Google sign-in is temporarily unavailable. Use email verification to sign in.",
        code: "CIRCLE_SOCIAL_AUTH_SERVER_VERIFICATION_REQUIRED",
    }, { status: 503 });
}
