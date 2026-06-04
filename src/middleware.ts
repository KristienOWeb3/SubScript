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
/* authLimiter: 5 requests per 15 minutes (sliding window) */
const authLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    analytics: true,
    prefix: "ratelimit:auth",
});

/* globalLimiter: 100 requests per 15 minutes (sliding window) */
const globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "15 m"),
    analytics: true,
    prefix: "ratelimit:global",
});

/* CLI-specific rate limiters (Addition 2) */
const cliSessionCreateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:session:create",
});

const cliSessionValidateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:session:validate",
});

const cliTelemetryLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    analytics: true,
    prefix: "ratelimit:cli:telemetry",
});

/* Define strict payload size limit: 1MB in bytes */
const MAX_PAYLOAD_SIZE = 1048576;

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

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
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.mp4|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
};
