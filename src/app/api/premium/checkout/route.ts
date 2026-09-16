import { NextResponse } from "next/server";

const retired = () => NextResponse.json({
    error: "Gone: paid merchant tiers have been retired. Access is based only on KYC verification tiers.",
}, { status: 410 });

export async function GET() {
    return retired();
}

export async function POST() {
    return retired();
}