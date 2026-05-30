import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SignJWT } from "jose";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { address, signature, nonce } = body;
        if (!address || !signature || !nonce) {
            return NextResponse.json({ error: "Address, signature, and nonce are required" }, { status: 400 });
        }

        const cookieStore = request.headers.get("cookie") || "";
        const nonceMatch = cookieStore.match(/subscript_siwe_nonce=([^;]+)/);
        const storedNonce = nonceMatch ? nonceMatch[1] : null;

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

        const secretStr = process.env.JWT_SECRET || "default_jwt_secret_fallback_32_characters_long_minimum";
        const secret = new TextEncoder().encode(secretStr);
        
        const now = Date.now();
        const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
        const jwt = await new SignJWT({ address: address.toLowerCase(), authenticatedAt: now })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("30d")
            .sign(secret);

        const response = NextResponse.json({ success: true, wallet: address });
        
        response.cookies.set("subscript_session_token", jwt, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            expires: expiresAt,
        });

        response.cookies.set("subscript_siwe_nonce", "", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            maxAge: 0,
        });

        return response;
    } catch (error: any) {
        console.error("Signature verification error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}