import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SignJWT } from "jose";
import { sanitizeInput } from "@/utils/security";
import { getCookieValue } from "@/lib/auth";
import { getAccountRole } from "@/lib/accounts/roles";
import { verifyCaptchaToken } from "@/lib/captcha";
import { clearSiweNonceCookie, setSessionCookie } from "@/lib/authCookies";

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

        const message = `Sign this message to verify ownership of your SubScript Merchant Dashboard.\n\nNonce: ${nonce}`;

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
            const isValid = await verifyCaptchaToken(captchaToken);
            if (!isValid) {
                return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
            }
        }

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "Internal Server Error: Secret key configuration missing" }, { status: 500 });
        }
        const secret = new TextEncoder().encode(secretStr);
        
        const now = Date.now();
        const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
        const jwt = await new SignJWT({ address: address.toLowerCase(), authenticatedAt: now })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("30d")
            .sign(secret);

        const response = NextResponse.json({ success: true, wallet: address, role });
        
        setSessionCookie(response, request, jwt, expiresAt);
        clearSiweNonceCookie(response, request);

        return response;
    } catch (error: any) {
        console.error("Signature verification error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
