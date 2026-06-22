import { NextResponse } from "next/server";
import crypto from "crypto";
import { setSiweNonceCookie } from "@/lib/authCookies";

export async function GET(request: Request) {
    try {
        const nonce = crypto.randomBytes(16).toString("hex");
        const response = NextResponse.json({ nonce });

        setSiweNonceCookie(response, request, nonce);

        return response;
    } catch (error) {
        console.error("Nonce generation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
