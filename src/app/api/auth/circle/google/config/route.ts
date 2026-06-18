import { NextResponse } from "next/server";

export async function GET() {
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI;
    const deviceToken = process.env.CIRCLE_DEVICE_TOKEN;
    const deviceEncryptionKey = process.env.CIRCLE_DEVICE_ENCRYPTION_KEY;

    if (!appId || !googleClientId || !redirectUri || !deviceToken || !deviceEncryptionKey) {
        return NextResponse.json({ error: "Circle Google login is not configured" }, { status: 500 });
    }

    return NextResponse.json({
        appId,
        googleClientId,
        redirectUri,
        deviceToken,
        deviceEncryptionKey,
    });
}
