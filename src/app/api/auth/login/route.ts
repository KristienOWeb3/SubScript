import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SignJWT } from "jose";
import { sanitizeInput } from "@/utils/security";
import { setSessionCookie } from "@/lib/authCookies";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { address, message, signature } = sanitizedBody;

        /* Strict validation of payload format and types */
        if (
            typeof address !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(address) ||
            typeof message !== "string" ||
            typeof signature !== "string" ||
            !signature.startsWith("0x")
        ) {
            return NextResponse.json(
                { error: "Malformed payload structure" },
                { status: 400 }
            );
        }

        if (!message.startsWith("Access SubScript Developer Portal: ")) {
            return NextResponse.json(
                { error: "Invalid authentication message text" },
                { status: 400 }
            );
        }

        const timestampStr = message.replace("Access SubScript Developer Portal: ", "");
        const timestamp = parseInt(timestampStr, 10);
        const now = Date.now();

        if (isNaN(timestamp)) {
            return NextResponse.json({ error: "Invalid timestamp in message" }, { status: 400 });
        }

        const fiveMinutes = 5 * 60 * 1000;
        if (Math.abs(now - timestamp) > fiveMinutes) {
            return NextResponse.json(
                { error: "Authentication request expired (clock drift or replay attack)" },
                { status: 400 }
            );
        }

        const isValid = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
        });

        if (!isValid) {
            return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
        }

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "Internal Server Error: Secret key configuration missing" }, { status: 500 });
        }
        const secret = new TextEncoder().encode(secretStr);
        const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
        const jwt = await new SignJWT({ address: address.toLowerCase(), authenticatedAt: now })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("30d")
            .sign(secret);

        const response = NextResponse.json({ success: true, wallet: address });
        
        setSessionCookie(response, request, jwt, expiresAt);

        return response;
    } catch (error: any) {
        console.error("Login API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
