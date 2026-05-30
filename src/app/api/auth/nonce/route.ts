import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
    try {
        const nonce = crypto.randomBytes(16).toString("hex");
        const response = NextResponse.json({ nonce });

        response.cookies.set("subscript_siwe_nonce", nonce, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            maxAge: 300,
        });

        return response;
    } catch (error) {
        console.error("Nonce generation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
