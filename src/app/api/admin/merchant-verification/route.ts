import { NextResponse } from "next/server";

function gone() {
    return NextResponse.json(
        {
            error: "Merchant verification is now managed through the KYC verification lifecycle.",
        },
        { status: 410 }
    );
}

export const GET = gone;
export const POST = gone;
