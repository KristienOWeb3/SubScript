import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
    // Unlocked all pages per user request
    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.mp4|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
};
