import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { normalizeAccountEmail } from "@/lib/auth/accountEmail";
import { consumeDistributedRateLimit, rateLimitKeyDigest } from "@/lib/distributedRateLimit";
import { verifyCaptchaToken } from "@/lib/captcha";

/* Public intake for merchant access. A business submits its email; an admin decides.
 *
 * UNIFORM RESPONSE, always. New request, duplicate submission, already approved, previously
 * declined — every one of them gets the same body. Anything else turns this endpoint into an
 * oracle for "which businesses did SubScript approve", and the answer is nobody's business but
 * theirs. Same posture as /api/auth/check-account, which refuses to confirm whether an email has
 * an account.
 *
 * Nothing here grants anything. The row this writes is a request; the grant an admin writes later
 * is the thing signup actually checks.
 */

const RATE_LIMIT_PER_IP = 5;
const RATE_LIMIT_PER_EMAIL = 3;
const RATE_WINDOW_SECONDS = 3600;

const UNIFORM_RESPONSE = {
    success: true,
    message: "Thanks — we've got your details. We review new merchants by hand, so give us a day or two.",
};

const field = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid submission payload." }, { status: 400 });
        }

        const sanitized = sanitizeInput(body);
        const { email, companyName, website, contactName, useCase, monthlyVolume, honeypot, captchaToken } = sanitized;

        /* Bots fill hidden fields. Answer exactly like a real submission so they learn nothing. */
        if (honeypot) {
            console.warn("[merchant-access] honeypot triggered, ignoring submission");
            return NextResponse.json(UNIFORM_RESPONSE);
        }

        const normalizedEmail = normalizeAccountEmail(email);
        if (!normalizedEmail) {
            return NextResponse.json({ error: "Enter a valid business email address." }, { status: 400 });
        }

        const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "")
            .split(",")[0]
            .trim() || "unknown";

        /* Fails CLOSED with 503: a public write endpoint with its limiter down is exactly what
           someone floods, and a review queue full of junk costs an operator real time. */
        try {
            const [byIp, byEmail] = await Promise.all([
                consumeDistributedRateLimit({
                    scope: "merchant-access-request-ip",
                    key: rateLimitKeyDigest(ip),
                    limit: RATE_LIMIT_PER_IP,
                    windowSeconds: RATE_WINDOW_SECONDS,
                }),
                consumeDistributedRateLimit({
                    scope: "merchant-access-request-email",
                    key: rateLimitKeyDigest(normalizedEmail),
                    limit: RATE_LIMIT_PER_EMAIL,
                    windowSeconds: RATE_WINDOW_SECONDS,
                }),
            ]);
            if (!byIp.ok || !byEmail.ok) {
                const retryAfter = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
                return NextResponse.json(
                    { error: "You've sent this a few times already. Try again a bit later." },
                    { status: 429, headers: { "Retry-After": String(retryAfter) } },
                );
            }
        } catch (error) {
            console.error("[merchant-access] rate limiter failed:", error);
            return NextResponse.json(
                { error: "We can't take requests right now. Please try again shortly." },
                { status: 503, headers: { "Retry-After": "30" } },
            );
        }

        if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
            const captchaOk = await verifyCaptchaToken(
                typeof captchaToken === "string" ? captchaToken : null,
                ip,
            );
            if (!captchaOk) {
                return NextResponse.json(
                    { error: "Security check failed. Refresh the page and try again." },
                    { status: 400 },
                );
            }
        }

        const details = {
            companyName: field(companyName, 200),
            website: field(website, 300),
            contactName: field(contactName, 160),
            useCase: field(useCase, 1000),
            monthlyVolume: field(monthlyVolume, 60),
            ip,
        };

        /* A resubmission updates the business's own row rather than stacking duplicates in the
           queue — but it must not resurrect a decided request, or a declined business could
           re-open its own review on a loop. */
        const existing = await prisma.merchantAccessRequest.findUnique({
            where: { email: normalizedEmail },
            select: { status: true },
        });

        if (!existing) {
            await prisma.merchantAccessRequest.create({
                data: { email: normalizedEmail, ...details },
            });
        } else if (existing.status === "PENDING") {
            await prisma.merchantAccessRequest.update({
                where: { email: normalizedEmail },
                data: details,
            });
        }

        return NextResponse.json(UNIFORM_RESPONSE);
    } catch (error) {
        console.error("[merchant-access] request failed:", error);
        return NextResponse.json(
            { error: "Something went wrong on our end. Try again in a minute." },
            { status: 500 },
        );
    }
}
