import { NextResponse } from "next/server";
import { isUsableCircleApiKey } from "@/lib/circle/client";

function resolveRedirectUri(request: Request, configuredRedirectUri: string | undefined) {
    const requestUrl = new URL(request.url);
    const forwardedHost = (request.headers.get("x-forwarded-host") || "").split(",")[0].trim();
    const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
    const requestHost = (forwardedHost || requestUrl.host).toLowerCase().replace(/:\d+$/, "");
    const protocol = forwardedProto || requestUrl.protocol.replace(":", "");
    const derivedRedirectUri = `${protocol}://${forwardedHost || requestUrl.host}/auth/popup`;
    if (!configuredRedirectUri) return derivedRedirectUri;

    try {
        const configuredUrl = new URL(configuredRedirectUri);
        const configuredHost = configuredUrl.hostname.toLowerCase();
        const configuredIsLocal = configuredHost === "localhost" || configuredHost === "127.0.0.1";
        const requestIsLocal = requestHost === "localhost" || requestHost === "127.0.0.1";
        if (configuredIsLocal && !requestIsLocal) return derivedRedirectUri;
    } catch {
        return derivedRedirectUri;
    }

    return configuredRedirectUri;
}

export async function GET(request: Request) {
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID || process.env.CIRCLE_APP_ID;
    const googleClientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = resolveRedirectUri(request, process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI || process.env.CIRCLE_GOOGLE_REDIRECT_URI);
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
