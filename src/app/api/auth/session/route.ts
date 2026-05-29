import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        
        if (!wallet) {
            return NextResponse.json({ loggedIn: false }, { status: 200 });
        }

        return NextResponse.json({ loggedIn: true, wallet }, { status: 200 });
    } catch (error) {
        console.error("Session API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
