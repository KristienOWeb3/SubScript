import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { address, message, signature } = body;

        if (!address || !message || !signature) {
            return NextResponse.json(
                { error: "Address, message, and signature are required" },
                { status: 400 }
            );
        }

        // 1. Verify that the message format is correct
        if (!message.startsWith("Access SubScript Developer Portal: ")) {
            return NextResponse.json(
                { error: "Invalid authentication message text" },
                { status: 400 }
            );
        }

        // 2. Extract and validate timestamp to prevent replay attacks
        const timestampStr = message.replace("Access SubScript Developer Portal: ", "");
        const timestamp = parseInt(timestampStr, 10);
        const now = Date.now();

        if (isNaN(timestamp)) {
            return NextResponse.json({ error: "Invalid timestamp in message" }, { status: 400 });
        }

        // Allow 5 minutes clock drift / window
        const fiveMinutes = 5 * 60 * 1000;
        if (Math.abs(now - timestamp) > fiveMinutes) {
            return NextResponse.json(
                { error: "Authentication request expired (clock drift or replay attack)" },
                { status: 400 }
            );
        }

        // 3. Cryptographically verify signature
        const isValid = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
        });

        if (!isValid) {
            return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
        }

        // 4. Create database session
        const sessionToken = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000); // 30 days session expiry

        await prisma.session.create({
            data: {
                wallet: address.toLowerCase(),
                token: sessionToken,
                expiresAt,
            },
        });

        // 5. Create Response and set secure HTTP-only cookie
        const response = NextResponse.json({ success: true, wallet: address });
        
        response.cookies.set("subscript_session_token", sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            expires: expiresAt,
        });

        return response;
    } catch (error: any) {
        console.error("Login API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
