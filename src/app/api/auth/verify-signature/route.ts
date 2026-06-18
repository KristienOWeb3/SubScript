import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SignJWT } from "jose";
import { sanitizeInput } from "@/utils/security";
import { getCookieValue } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { address, signature, nonce } = sanitizedBody;
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

        let role: string | null = null;
        try {
            const roleRecord = await prisma.accountRole.findUnique({
                where: { address: address.toLowerCase() }
            });
            if (roleRecord) {
                role = roleRecord.role;
            }
        } catch (e) {
            console.warn("Could not query role:", e);
        }

        const response = NextResponse.json({ success: true, wallet: address, role });

        
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