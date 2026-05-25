import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Define public routes that do NOT need password lock
    const isPublicRoute = 
        pathname === "/" || 
        pathname === "/waitlist" || 
        pathname === "/lock" ||
        pathname === "/api/lock" ||
        pathname === "/subscript_human.mp4" || 
        pathname === "/favicon.ico" ||
        pathname === "/subscript_hero_3d_1768947910755.png" ||
        pathname.startsWith("/_next/static") ||
        pathname.startsWith("/_next/image");

    if (isPublicRoute) {
        return NextResponse.next();
    }

    // Check for access cookie
    const cookie = request.cookies.get("subscript_page_lock");
    if (cookie?.value === "SexyKristien") {
        return NextResponse.next();
    }

    // Redirect to lock page, preserving original path
    const url = request.nextUrl.clone();
    url.pathname = "/lock";
    url.searchParams.set("to", pathname);
    return NextResponse.redirect(url);
}

export const config = {
    // Run on all paths except for static assets
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.mp4|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
};
