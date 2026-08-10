import { NextResponse } from "next/server";
import { isUsableCircleApiKey } from "@/lib/circle/client";
import { isGoogleSigninEnabled } from "@/lib/platform/flags";

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

        if (requestIsLocal && !configuredIsLocal) {
            return derivedRedirectUri;
        }
        if (configuredIsLocal && !requestIsLocal) {
            return derivedRedirectUri;
        }
    } catch {
        return derivedRedirectUri;
    }

    return configuredRedirectUri;
}

export async function GET(request: Request) {
    /* Runtime kill switch, checked BEFORE the env checks below so an admin pausing Google
       gets a clean "unavailable" rather than a configuration error listing env vars. This
       is the server-side half of the pause: hiding the button alone would still leave the
       flow reachable by anyone who kept a tab open or hits the endpoint directly. */
    if (!(await isGoogleSigninEnabled())) {
        return NextResponse.json(
            { error: "Continue with Google is temporarily unavailable. Please sign in with email.", paused: true },
            { status: 503, headers: { "Cache-Control": "no-store" } },
        );
    }

    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID || process.env.CIRCLE_APP_ID;
    const googleClientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = resolveRedirectUri(request, process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI || process.env.CIRCLE_GOOGLE_REDIRECT_URI);
    const circleApiKey = process.env.CIRCLE_API_KEY;

    const missing: string[] = [];
    if (!appId) missing.push("NEXT_PUBLIC_CIRCLE_APP_ID");
    if (!googleClientId) missing.push("a Google OAuth client id (NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID)");
    if (!redirectUri) missing.push("NEXT_PUBLIC_CIRCLE_GOOGLE_REDIRECT_URI");
    if (!isUsableCircleApiKey(circleApiKey)) missing.push("a real CIRCLE_API_KEY (currently missing or a placeholder)");

    if (missing.length > 0) {
        return NextResponse.json({
            error: `Continue with Google isn't configured on the server. Missing: ${missing.join(", ")}. Set these in your deployment environment and redeploy.`,
            missing,
        }, { status: 500 });
    }

    return NextResponse.json({
        appId,
        googleClientId,
        redirectUri,
    });
}
