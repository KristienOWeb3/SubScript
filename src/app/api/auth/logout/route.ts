import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/authCookies";
import { revokeSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
    try {
        await revokeSessionToken(request.headers);
        const response = NextResponse.json({ success: true });
        
        clearSessionCookie(response, request);

        return response;
    } catch (error) {
        console.error("Logout API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
