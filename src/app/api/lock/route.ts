import { NextResponse } from "next/server";

export async function POST(request: Request) {
    try {
        const { password } = await request.json();

        if (password === "SexyKristien") {
            const response = NextResponse.json({ success: true });
            
            // Set secure HTTP-only cookie, valid for 30 days
            response.cookies.set("subscript_page_lock", "SexyKristien", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/",
                maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
            });

            // Set client-accessible cookie for dev/test bypass checks
            response.cookies.set("subscript_page_lock_client", "SexyKristien", {
                httpOnly: false,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/",
                maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
            });

            return response;
        }

        return NextResponse.json(
            { success: false, message: "Invalid access code" },
            { status: 401 }
        );
    } catch (error) {
        return NextResponse.json(
            { success: false, message: "Server error" },
            { status: 500 }
        );
    }
}
