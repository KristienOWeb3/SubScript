import { NextResponse } from "next/server";
import { generateCaptcha, createCaptchaToken } from "@/lib/captcha";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const { code, svg } = generateCaptcha();
        const token = createCaptchaToken(code);

        return NextResponse.json(
            { svg, token },
            {
                status: 200,
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            }
        );
    } catch (err: any) {
        console.error("Failed to generate captcha:", err);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
