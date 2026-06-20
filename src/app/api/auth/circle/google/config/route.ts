import { NextResponse } from "next/server";

export async function GET() {
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID || process.env.CIRCLE_APP_ID;
    const googleClientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI || process.env.CIRCLE_GOOGLE_REDIRECT_URI;

    if (!appId || !googleClientId || !redirectUri) {
        return NextResponse.json({
            error: "Circle Google login is not configured. Set NEXT_PUBLIC_CIRCLE_APP_ID, NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI, CIRCLE_API_KEY, and the Google OAuth client id.",
        }, { status: 500 });
    }

    return NextResponse.json({
        appId,
        googleClientId,
        redirectUri,
    });
}
