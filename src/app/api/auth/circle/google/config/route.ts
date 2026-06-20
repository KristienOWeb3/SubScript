import { NextResponse } from "next/server";

export async function GET() {
    const appId = process.env.CIRCLE_APP_ID;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.CIRCLE_GOOGLE_REDIRECT_URI;

    if (!appId || !googleClientId || !redirectUri) {
        return NextResponse.json({ isMock: true });
    }

    return NextResponse.json({
        appId,
        googleClientId,
        redirectUri,
        isMock: false
    });
}

