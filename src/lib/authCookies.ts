import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import type { NextResponse } from "next/server";

function cookieDomain(request: Request) {
    const hosts = [
        request.headers.get("x-forwarded-host"),
        request.headers.get("host"),
    ]
        .flatMap((value) => (value || "").split(","))
        .map((value) => value.trim().toLowerCase().replace(/:\d+$/, ""))
        .filter(Boolean);

    if (hosts.some((host) => host === "subscriptonarc.com" || host === "www.subscriptonarc.com" || host === "dashboard.subscriptonarc.com")) {
        return ".subscriptonarc.com";
    }

    return undefined;
}

function baseCookieOptions(request: Request): Partial<ResponseCookie> {
    const domain = cookieDomain(request);
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        ...(domain ? { domain } : {}),
    };
}

export function setSessionCookie(response: NextResponse, request: Request, token: string, expires: Date) {
    response.cookies.set("subscript_session_token", token, {
        ...baseCookieOptions(request),
        /* Lax, not Strict: an installed PWA launched from the home screen makes a top-level
           navigation with no same-site referrer, and browsers withhold SameSite=Strict cookies on
           that request. With Strict the middleware (which gates the dashboard host on this cookie)
           sees no token every cold launch and forces a re-login. Lax still sends the cookie on
           top-level GET navigations (keeping the session) while blocking it on cross-site POST /
           subresource requests, so CSRF protection for the session is preserved. */
        sameSite: "lax",
        expires,
    });
}

export function clearSessionCookie(response: NextResponse, request: Request) {
    response.cookies.set("subscript_session_token", "", {
        ...baseCookieOptions(request),
        maxAge: 0,
    });
}

export function setSiweNonceCookie(response: NextResponse, request: Request, nonce: string) {
    response.cookies.set("subscript_siwe_nonce", nonce, {
        ...baseCookieOptions(request),
        maxAge: 300,
    });
}

export function clearSiweNonceCookie(response: NextResponse, request: Request) {
    response.cookies.set("subscript_siwe_nonce", "", {
        ...baseCookieOptions(request),
        maxAge: 0,
    });
}
