import { NextResponse } from "next/server";
import { isUsableCircleApiKey } from "@/lib/circle/client";

export async function GET() {
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID || process.env.CIRCLE_APP_ID;
    const googleClientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI || process.env.CIRCLE_GOOGLE_REDIRECT_URI;
    const circleApiKey = process.env.CIRCLE_API_KEY;

    if (!appId || !googleClientId || !redirectUri || !isUsableCircleApiKey(circleApiKey)) {
        return NextResponse.json({
            error: "Circle Google login is not configured. Set NEXT_PUBLIC_CIRCLE_APP_ID, NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI, a Google OAuth client id, and a real CIRCLE_API_KEY.",
        }, { status: 500 });
    }

    return NextResponse.json({
        appId,
        googleClientId,
        redirectUri,
    });
}
