import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* Initialize Upstash Redis REST client */
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

/* Create two separate rate limiters using the Redis client */
/* authLimiter: 20 requests per 1 minute (sliding window) */
const authLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    analytics: true,
    prefix: "ratelimit:auth",
});

/* globalLimiter: 150 requests per 1 minute (sliding window) */
const globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(150, "1 m"),
    analytics: true,
    prefix: "ratelimit:global",
});

/* CLI-specific rate limiters */
const cliSessionCreateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:session:create",
});

const cliSessionValidateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(180, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:session:validate",
});

const cliTelemetryLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(600, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:telemetry",
});

/* Define strict payload size limit: 1MB in bytes */
const MAX_PAYLOAD_SIZE = 1048576;

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const host = request.headers.get("host") || "";
    const isProductionDomain = host.includes("subscriptonarc.com") || host.includes("subscriptonarc");

    if (isProductionDomain) {
        // 1. Redirect dashboard paths on the main landing domain to the dashboard subdomain
        if (host === "subscriptonarc.com" || host === "www.subscriptonarc.com") {
            if (pathname.startsWith("/dashboard")) {
                const subUrl = request.nextUrl.clone();
                subUrl.host = "dashboard.subscriptonarc.com";
                if (pathname === "/dashboard") {
                    subUrl.pathname = "/merchant";
                } else if (pathname.startsWith("/dashboard/user")) {
                    subUrl.pathname = pathname.replace(/^\/dashboard\/user/, "/user");
                }
                return NextResponse.redirect(subUrl);
            }
        }

        // 2. Manage dashboard subdomain routing
        if (host === "dashboard.subscriptonarc.com") {
            const token = request.cookies.get("subscript_session_token")?.value;

            // If not logged in, redirect to landing sign-in page
            if (!token && pathname !== "/signin" && pathname !== "/login" && pathname !== "/signup") {
                return NextResponse.redirect("https://subscriptonarc.com/login");
            }

            if (pathname === "/") {
                const userUrl = request.nextUrl.clone();
                userUrl.pathname = "/user";
                return NextResponse.redirect(userUrl);
            }

            if (pathname === "/signin" || pathname === "/login" || pathname === "/signup") {
                return NextResponse.redirect(`https://subscriptonarc.com${pathname}`);
            }

            // Rewrite /user paths to /dashboard/user internally
            if (pathname.startsWith("/user")) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = pathname.replace(/^\/user/, "/dashboard/user");
                return NextResponse.rewrite(rewriteUrl);
            }

            // Rewrite /merchant paths to /dashboard internally
            if (pathname.startsWith("/merchant")) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = pathname.replace(/^\/merchant/, "/dashboard");
                return NextResponse.rewrite(rewriteUrl);
            }
        }
    }

    const requestHeaders = new Headers(request.headers);
    const country = (request as any).geo?.country || request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || "US";
    requestHeaders.set("x-user-country", country);

    /* Step 3: Payload Size Limitations */
    if (request.method === "POST" || request.method === "PUT") {
        const contentLengthHeader = request.headers.get("content-length");
        if (contentLengthHeader) {
            const contentLength = parseInt(contentLengthHeader, 10);
            if (isNaN(contentLength) || contentLength > MAX_PAYLOAD_SIZE) {
                return new NextResponse(
                    JSON.stringify({ error: "Payload Too Large" }),
                    { status: 413, headers: { "Content-Type": "application/json" } }
                );
            }
        }
    }

    /* Apply rate limiting only to API endpoints */
    if (pathname.startsWith("/api")) {
        /* Read user's IP address */
        const ip = (request as any).ip || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

        /* If Upstash Redis is not configured, bypass rate limiting (fail-open) */
        const isRedisConfigured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

        if (isRedisConfigured) {
            try {
                /* Handle CLI Rate Limits first */
                if (pathname === "/api/cli/session") {
                    const limiter = request.method === "POST" ? cliSessionCreateLimiter : cliSessionValidateLimiter;
                    const { success } = await limiter.limit(ip);
                    if (!success) {
                        return new NextResponse(
                            JSON.stringify({ error: "Too Many Requests" }),
                            { status: 429, headers: { "Content-Type": "application/json" } }
                        );
                    }
                } else if (pathname === "/api/cli/analytics") {
                    const { success } = await cliTelemetryLimiter.limit(ip);
                    if (!success) {
                        return new NextResponse(
                            JSON.stringify({ error: "Too Many Requests" }),
                            { status: 429, headers: { "Content-Type": "application/json" } }
                        );
                    }
                } else {
                    /* Existing Web/Dashboard API Rate Limiting */
                    const isAuthRoute =
                        pathname === "/api/auth/login" ||
                        pathname === "/api/auth/otp/verify" ||
                        pathname === "/api/auth/verify-signature" ||
                        pathname === "/api/auth/otp/send" ||
                        pathname === "/api/auth/social";

                    if (isAuthRoute) {
                        /* Execute the authLimiter rate limit check */
                        const { success } = await authLimiter.limit(ip);
                        if (!success) {
                            return new NextResponse(
                                JSON.stringify({ error: "Too Many Requests" }),
                                { status: 429, headers: { "Content-Type": "application/json" } }
                            );
                        }
                    } else {
                        /* Execute the globalLimiter rate limit check */
                        const { success } = await globalLimiter.limit(ip);
                        if (!success) {
                            return new NextResponse(
                                JSON.stringify({ error: "Too Many Requests" }),
                                { status: 429, headers: { "Content-Type": "application/json" } }
                            );
                        }
                    }
                }
            } catch (err) {
                /* Fail-open on rate limiter error to prevent blocking users */
                console.error("Rate limiting execution error:", err);
            }
        }
    }

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.mp4|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
};
