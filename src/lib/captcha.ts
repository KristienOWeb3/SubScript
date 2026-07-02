import { assertProviderRateLimit } from "@/lib/providerRateLimit";

/**
 * Verifies a Cloudflare Turnstile token via the siteverify API.
 *
 * Fails CLOSED: if `TURNSTILE_SECRET_KEY` is not configured, verification is rejected rather than
 * falling back to an always-pass test key. This is deliberate — the previous reCAPTCHA path fell
 * back to Google's public test secret, which silently disabled bot protection whenever the real
 * secret was missing. A misconfiguration must break signups loudly, not wave bots through.
 */
export async function verifyCaptchaToken(
    turnstileToken: string | null | undefined,
    _ignoredCode?: string | null | undefined
): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
        console.error("Captcha verification failed: TURNSTILE_SECRET_KEY is not configured (failing closed).");
        return false;
    }
    if (!turnstileToken) {
        console.warn("Captcha verification failed: token is empty");
        return false;
    }

    try {
        assertProviderRateLimit({
            provider: "captcha-verification",
            key: "global",
            limit: 300,
            windowMs: 60 * 1000,
        });

        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(turnstileToken)}`,
        });

        const data = await response.json();
        if (data.success) {
            return true;
        }
        console.warn("Turnstile verification failed:", data["error-codes"]);
        return false;
    } catch (err) {
        console.error("Error communicating with Turnstile API:", err);
        return false;
    }
}
