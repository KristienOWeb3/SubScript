import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const cookieStore = request.headers.get("cookie") || "";
        // Extract subscript_session_token from headers
        const tokenMatch = cookieStore.match(/subscript_session_token=([^;]+)/);
        const token = tokenMatch ? tokenMatch[1] : null;

        if (token) {
            // Delete session from DB
            await prisma.session.deleteMany({
                where: { token },
            });
        }

        const response = NextResponse.json({ success: true });
        
        // Clear the cookie by setting maxAge = 0
        response.cookies.set("subscript_session_token", "", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            maxAge: 0,
        });

        return response;
    } catch (error) {
        console.error("Logout API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
