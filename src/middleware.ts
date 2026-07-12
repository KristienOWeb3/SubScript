import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis/cloudflare";
import { Ratelimit } from "@upstash/ratelimit";

const PUBLIC_HOST = "www.subscriptonarc.com";
const APEX_HOST = "subscriptonarc.com";
const DASHBOARD_HOST = "dashboard.subscriptonarc.com";
const CHECKOUT_HOST = "pay.subscriptonarc.com";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;

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

/* In-memory rate limiting fallbacks & burst prevention */
const memoryBans = new Map<string, number>(); // ip -> ban expiration timestamp
const memoryViolations = new Map<string, number[]>(); // ip -> array of rate limit violation timestamps
const memoryBurstLimiter = new Map<string, number[]>(); // ip -> timestamps within the last 10s

class MemoryLimiter {
    private store = new Map<string, number[]>();
    private windowMs: number;
    private maxRequests: number;

    constructor(windowMs: number, maxRequests: number) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    limit(ip: string): boolean {
        const now = Date.now();
        let timestamps = this.store.get(ip) || [];
        timestamps = timestamps.filter(t => now - t < this.windowMs);
        if (timestamps.length >= this.maxRequests) {
            return false;
        }
        timestamps.push(now);
        this.store.set(ip, timestamps);
        return true;
    }
}

const authMemoryLimiter = new MemoryLimiter(60 * 1000, 20);
const globalMemoryLimiter = new MemoryLimiter(60 * 1000, 150);
const cliCreateSessionMemoryLimiter = new MemoryLimiter(60 * 1000, 60);
const cliValidateSessionMemoryLimiter = new MemoryLimiter(60 * 1000, 180);
const cliTelemetryMemoryLimiter = new MemoryLimiter(60 * 1000, 600);

function createNonce() {
    const nonceSource = crypto.randomUUID();
    return btoa(nonceSource);
}

function createContentSecurityPolicy(nonce: string) {
    const scriptSources = [
        "'self'",
        `'nonce-${nonce}'`,
        ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
        "https://challenges.cloudflare.com",
        "https://www.google.com",
        "https://www.gstatic.com",
        "https://us.i.posthog.com",
        "https://us-assets.i.posthog.com",
        "https://auth.privy.io",
        "https://api.privy.io",
        "https://relay.walletconnect.com",
        "https://api.circle.com",
        "https://iris-api-sandbox.circle.com",
    ].join(" ");
    const styleSources = process.env.NODE_ENV === "production"
        ? ["'self'", `'nonce-${nonce}'`].join(" ")
        : ["'self'", "'unsafe-inline'"].join(" ");

    return [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "form-action 'self'",
        `script-src ${scriptSources}`,
        `style-src ${styleSources}`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob: https://subscriptonarc.com https://www.subscriptonarc.com https://dashboard.subscriptonarc.com https://us.i.posthog.com https://us-assets.i.posthog.com https://explorer.arc.network https://explorer.testnet.arc.network https://jkrlsjpsytzffwjpixue.supabase.co",
        "font-src 'self' data:",
        "connect-src 'self' https://challenges.cloudflare.com https://subscriptonarc.com https://www.subscriptonarc.com https://dashboard.subscriptonarc.com https://us.i.posthog.com https://us-assets.i.posthog.com https://auth.privy.io https://api.privy.io https://relay.walletconnect.com wss://relay.walletconnect.com https://api.circle.com https://iris-api-sandbox.circle.com https://rpc.testnet.arc.network wss://ws.testnet.arc.network https://explorer.arc.network https://explorer.testnet.arc.network https://ethereum-rpc.publicnode.com https://ethereum-sepolia-rpc.publicnode.com https://rpc.ankr.com https://sepolia.gateway.tenderly.co https://1rpc.io https://5042002.rpc.thirdweb.com https://jkrlsjpsytzffwjpixue.supabase.co",
        "frame-src 'self' https://challenges.cloudflare.com https://www.google.com https://auth.privy.io https://relay.walletconnect.com https://api.circle.com https://pw-auth.circle.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
    ].join("; ");
}

function checkBurstLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 10 * 1000; // 10 seconds
    const maxBurst = 25; // Max 25 requests per 10 seconds per IP (protects Redis and backend from spikes)
    
    let timestamps = memoryBurstLimiter.get(ip) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);
    
    if (timestamps.length >= maxBurst) {
        return false;
    }
    
    timestamps.push(now);
    memoryBurstLimiter.set(ip, timestamps);
    return true;
}

function rateLimitResponse(message = "Too Many Requests") {
    return new NextResponse(
        JSON.stringify({ error: message }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
    );
}

async function handleRateLimitViolation(ip: string, isRedisConfigured: boolean) {
    const violationWindowMs = 3600 * 1000; // 1 hour
    const banDurationSeconds = 86400; // 24 hours
    const maxViolationsBeforeBan = 5;
    const now = Date.now();

    if (isRedisConfigured) {
        try {
            const key = `violations:${ip}`;
            const count = await redis.incr(key);
            if (count === 1) {
                await redis.expire(key, 3600);
            }
            if (count >= maxViolationsBeforeBan) {
                await redis.setex(`ban:${ip}`, banDurationSeconds, "true");
                console.warn(`[Rate Limit] IP ${ip} dynamically banned in Redis for 24 hours due to repeated rate limit violations.`);
            }
        } catch (err) {
            console.error("Error updating rate limit violations in Redis:", err);
        }
    }

    // In-memory tracking fallback
    let list = memoryViolations.get(ip) || [];
    list = list.filter(t => now - t < violationWindowMs);
    list.push(now);
    memoryViolations.set(ip, list);

    if (list.length >= maxViolationsBeforeBan) {
        memoryBans.set(ip, now + banDurationSeconds * 1000);
        console.warn(`[Rate Limit] IP ${ip} temporarily banned in-memory for 24 hours.`);
    }
}

/* Define strict payload size limit: 1MB in bytes */
const MAX_PAYLOAD_SIZE = 1048576;

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const isApiRoute = pathname === "/api" || pathname.startsWith("/api/");
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
        .split(",")[0]
        .trim()
        .toLowerCase()
        .replace(/:\d+$/, "");
    const isDashboardHost = host === DASHBOARD_HOST;
    const isCheckoutHost = host === CHECKOUT_HOST;
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const isDashboardPath =
        pathname === "/dashboard" || pathname.startsWith("/dashboard/") ||
        pathname === "/merchant" || pathname.startsWith("/merchant/") ||
        pathname === "/user" || pathname.startsWith("/user/");
    const isPublicCheckoutPath =
        pathname === "/pay" || pathname.startsWith("/pay/") ||
        pathname === "/receipt" || pathname.startsWith("/receipt/");
    const isProductionDomain = host === APEX_HOST
        || host === PUBLIC_HOST
        || isDashboardHost
        || isCheckoutHost;

    if (!isApiRoute && host === APEX_HOST) {
        const canonicalUrl = request.nextUrl.clone();
        canonicalUrl.host = PUBLIC_HOST;
        canonicalUrl.protocol = "https:";
        return NextResponse.redirect(canonicalUrl, 308);
    }

    if (!isApiRoute && isCheckoutHost) {
        if (pathname === "/" || pathname === "/signin" || pathname === "/login" || pathname === "/signup") {
            const publicUrl = request.nextUrl.clone();
            publicUrl.host = PUBLIC_HOST;
            publicUrl.protocol = "https:";
            return NextResponse.redirect(publicUrl, 308);
        }

        if (!isPublicCheckoutPath) {
            const checkoutUrl = request.nextUrl.clone();
            checkoutUrl.pathname = `/pay${pathname}`;
            return NextResponse.rewrite(checkoutUrl);
        }
    }

    if (!isApiRoute && !isDashboardHost && !isLocalHost && isDashboardPath && (host === APEX_HOST || host === PUBLIC_HOST)) {
        const subUrl = request.nextUrl.clone();
        subUrl.protocol = "https:";
        subUrl.host = DASHBOARD_HOST;
        if (pathname === "/dashboard") {
            subUrl.pathname = "/";
        } else if (pathname.startsWith("/dashboard/user")) {
            subUrl.pathname = pathname.replace(/^\/dashboard\/user/, "/user");
        } else if (pathname.startsWith("/dashboard/merchant")) {
            subUrl.pathname = pathname.replace(/^\/dashboard\/merchant/, "/merchant");
        }
        return NextResponse.redirect(subUrl);
    }

    if (isProductionDomain && !isApiRoute) {
        // 1. Redirect dashboard paths on the main landing domain to the dashboard subdomain
        if (host === APEX_HOST || host === PUBLIC_HOST) {
            if (pathname.startsWith("/dashboard")) {
                const subUrl = request.nextUrl.clone();
                subUrl.host = DASHBOARD_HOST;
                if (pathname === "/dashboard") {
                    subUrl.pathname = "/";
                } else if (pathname.startsWith("/dashboard/user")) {
                    subUrl.pathname = pathname.replace(/^\/dashboard\/user/, "/user");
                } else if (pathname.startsWith("/dashboard/merchant")) {
                    subUrl.pathname = pathname.replace(/^\/dashboard\/merchant/, "/merchant");
                }
                return NextResponse.redirect(subUrl);
            }
            if (
                pathname === "/merchant" || pathname.startsWith("/merchant/") ||
                pathname === "/user" || pathname.startsWith("/user/")
            ) {
                const subUrl = request.nextUrl.clone();
                subUrl.host = DASHBOARD_HOST;
                return NextResponse.redirect(subUrl);
            }
        }

        // 2. Manage dashboard subdomain routing
        if (isDashboardHost) {
            if (isPublicCheckoutPath) {
                const publicUrl = request.nextUrl.clone();
                publicUrl.host = PUBLIC_HOST;
                publicUrl.protocol = "https:";
                return NextResponse.redirect(publicUrl, 308);
            }

            const token = request.cookies.get("subscript_session_token")?.value;

            // If not logged in, redirect to landing sign-in page
            if (!token && pathname !== "/signin" && pathname !== "/login" && pathname !== "/signup") {
                return NextResponse.redirect(`${PUBLIC_ORIGIN}/login`);
            }

            if (pathname === "/" || pathname === "/dashboard") {
                const routerUrl = request.nextUrl.clone();
                routerUrl.pathname = "/dashboard-router";
                return NextResponse.rewrite(routerUrl);
            }

            if (pathname === "/signin" || pathname === "/login" || pathname === "/signup") {
                return NextResponse.redirect(`${PUBLIC_ORIGIN}${pathname}`);
            }

            // Keep canonical subdomain URLs public while supporting old dashboard URLs.
            if (pathname.startsWith("/dashboard/user")) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = pathname.replace(/^\/dashboard\/user/, "/user");
                return NextResponse.rewrite(rewriteUrl);
            }

            if (pathname.startsWith("/dashboard/merchant")) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = pathname.replace(/^\/dashboard\/merchant/, "/merchant");
                return NextResponse.rewrite(rewriteUrl);
            }

            if (pathname.startsWith("/dashboard/")) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = pathname.replace(/^\/dashboard/, "/merchant");
                return NextResponse.rewrite(rewriteUrl);
            }
        }
    }

    const requestHeaders = new Headers(request.headers);
    const nonce = createNonce();
    const contentSecurityPolicy = createContentSecurityPolicy(nonce);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

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

    /* Local development may use the E2E cookie. Production-mode CI uses an ephemeral token that
       exists only in that runner's environment and is attached by Playwright to every request.
       Deployed production has no token configured, so neither client-set cookies nor headers can
       bypass its rate limits. */
    const configuredE2eToken = process.env.E2E_RATE_LIMIT_BYPASS_TOKEN || "";
    const suppliedE2eToken = request.headers.get("x-subscript-e2e-token") || "";
    const hasCiE2eBypass = configuredE2eToken.length > 0
        && configuredE2eToken.length === suppliedE2eToken.length
        && configuredE2eToken === suppliedE2eToken;
    const isE2e = hasCiE2eBypass || (
        process.env.NODE_ENV !== "production"
        && request.cookies.get("subscript_e2e_test")?.value === "true"
    );
    /* Apply rate limiting only to API endpoints */
    if (pathname.startsWith("/api") && !isE2e) {
        /* Read user's IP address */
        const ip = (request as NextRequest & { ip?: string }).ip || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

        /* 1. Env-based IP Ban Check */
        const bannedIpsStr = process.env.BANNED_IPS || "";
        const bannedIps = bannedIpsStr.split(",").map(item => item.trim());
        if (bannedIps.includes(ip)) {
            return new NextResponse(
                JSON.stringify({ error: "Access Denied: Banned IP" }),
                { status: 403, headers: { "Content-Type": "application/json" } }
            );
        }

        /* 2. In-Memory IP Ban Check */
        const banExpiry = memoryBans.get(ip);
        if (banExpiry && banExpiry > Date.now()) {
            return new NextResponse(
                JSON.stringify({ error: "Access Denied: Banned IP" }),
                { status: 403, headers: { "Content-Type": "application/json" } }
            );
        }

        const isRedisConfigured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

        /* 3. Memory-based burst protection check before Redis so Redis cannot be hammered. */
        if (!checkBurstLimit(ip)) {
            await handleRateLimitViolation(ip, isRedisConfigured);
            return rateLimitResponse("Too Many Requests (Burst limit exceeded)");
        }

        /* 4. Redis IP Ban Check */
        if (isRedisConfigured) {
            try {
                const isBanned = await redis.get(`ban:${ip}`);
                if (isBanned) {
                    // Cache the ban in memory as well to avoid future redis queries
                    memoryBans.set(ip, Date.now() + 3600 * 1000); // 1 hour memory cache
                    return new NextResponse(
                        JSON.stringify({ error: "Access Denied: Banned IP" }),
                        { status: 403, headers: { "Content-Type": "application/json" } }
                    );
                }
            } catch (err) {
                console.error("Error checking IP ban in Redis:", err);
            }
        }

        let rateLimitPassed = true;
        let useMemoryFallback = !isRedisConfigured;

        if (isRedisConfigured) {
            try {
                /* Handle CLI Rate Limits first */
                if (pathname === "/api/cli/session") {
                    const limiter = request.method === "POST" ? cliSessionCreateLimiter : cliSessionValidateLimiter;
                    const { success } = await limiter.limit(ip);
                    rateLimitPassed = success;
                } else if (pathname === "/api/cli/analytics") {
                    const { success } = await cliTelemetryLimiter.limit(ip);
                    rateLimitPassed = success;
                } else {
                    /* Existing Web/Dashboard API Rate Limiting */
                    const isAuthRoute =
                        pathname === "/api/auth/login" ||
                        pathname === "/api/auth/otp/verify" ||
                        pathname === "/api/auth/verify-signature" ||
                        pathname === "/api/auth/otp/send";

                    if (isAuthRoute) {
                        const { success } = await authLimiter.limit(ip);
                        rateLimitPassed = success;
                    } else {
                        const { success } = await globalLimiter.limit(ip);
                        rateLimitPassed = success;
                    }
                }
            } catch (err) {
                console.error("Redis rate limit check error, falling back to memory:", err);
                useMemoryFallback = true;
                rateLimitPassed = true;
            }
        }

        if (!rateLimitPassed) {
            await handleRateLimitViolation(ip, isRedisConfigured);
            return rateLimitResponse();
        }

        /* 5. In-Memory Fallback Rate Limiting (used only when Redis is unconfigured or errors) */
        if (useMemoryFallback) {
            if (pathname === "/api/cli/session") {
                const limiter = request.method === "POST" ? cliCreateSessionMemoryLimiter : cliValidateSessionMemoryLimiter;
                rateLimitPassed = limiter.limit(ip);
            } else if (pathname === "/api/cli/analytics") {
                rateLimitPassed = cliTelemetryMemoryLimiter.limit(ip);
            } else {
                const isAuthRoute =
                    pathname === "/api/auth/login" ||
                    pathname === "/api/auth/otp/verify" ||
                    pathname === "/api/auth/verify-signature" ||
                    pathname === "/api/auth/otp/send";

                const limiter = isAuthRoute ? authMemoryLimiter : globalMemoryLimiter;
                rateLimitPassed = limiter.limit(ip);
            }
        }

        if (!rateLimitPassed) {
            await handleRateLimitViolation(ip, isRedisConfigured);
            return rateLimitResponse();
        }

        if (pathname === "/api" || pathname === "/api/") {
            const response = NextResponse.json({ error: "Not found" }, { status: 404 });
            response.headers.set("Content-Security-Policy", contentSecurityPolicy);
            response.headers.set("X-Frame-Options", "DENY");
            response.headers.set("X-Content-Type-Options", "nosniff");
            response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
            return response;
        }
    }

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.mp4|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
};
