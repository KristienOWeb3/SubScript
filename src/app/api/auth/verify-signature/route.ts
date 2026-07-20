import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { sanitizeInput } from "@/utils/security";
import { createSessionToken, getCookieValue } from "@/lib/auth";
import { pgMaybeOne } from "@/lib/serverPg";
import { getAccountRole } from "@/lib/accounts/roles";
import { verifyCaptchaToken } from "@/lib/captcha";
import { clearSiweNonceCookie, setSessionCookie } from "@/lib/authCookies";
import { buildWalletAuthMessage, walletAuthRequestContext } from "@/lib/walletAuthMessage";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { address, signature, nonce, captchaCode, captchaToken } = sanitizedBody;
        if (
            typeof address !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(address) ||
            typeof signature !== "string" ||
            !signature.startsWith("0x") ||
            typeof nonce !== "string"
        ) {
            return NextResponse.json({ error: "Malformed payload parameters" }, { status: 400 });
        }

        const cookieStore = request.headers.get("cookie") || "";
        const storedNonce = getCookieValue(cookieStore, "subscript_siwe_nonce");

        if (!storedNonce || storedNonce !== nonce) {
            return NextResponse.json({ error: "Authentication session expired or invalid nonce" }, { status: 400 });
        }

        /* Atomically consume the server-issued nonce (DELETE ... RETURNING, same pattern as the
           wallet-export OTP). The cookie above only binds the attempt to this browser — both
           values arrive from the client, so without this record a captured signature could be
           replayed indefinitely by re-presenting its nonce. Consuming before signature
           verification means every attempt burns the nonce and concurrent replays have exactly
           one winner; clients fetch a fresh nonce per attempt. */
        const consumedNonce = await pgMaybeOne<{ nonce: string }>(
            "delete from siwe_nonces where nonce = $1 and expires_at > now() returning nonce",
            [nonce]
        );
        if (!consumedNonce) {
            return NextResponse.json({ error: "Authentication session expired or invalid nonce" }, { status: 400 });
        }

        const context = walletAuthRequestContext(request);
        const message = buildWalletAuthMessage({ address, nonce, ...context });

        const isValid = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
        });

        if (!isValid) {
            return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
        }

        const role = await getAccountRole(address);

        if (!role) {
            // New wallet signup requires CAPTCHA validation
            const requesterIp = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
            const isValid = await verifyCaptchaToken(captchaToken, requesterIp);
            if (!isValid) {
                return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
            }
        }

        const { token: jwt, expiresAt } = await createSessionToken(address, 30 * 24 * 60 * 60 * 1000);

        const response = NextResponse.json({ success: true, wallet: address, role });
        
        setSessionCookie(response, request, jwt, expiresAt);
        clearSiweNonceCookie(response, request);

        return response;
    } catch (error: any) {
        console.error("Signature verification error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
