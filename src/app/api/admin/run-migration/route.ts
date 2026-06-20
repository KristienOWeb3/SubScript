import { NextResponse } from "next/server";

export async function POST() {
    // Database migrations must run through the reviewed migration workflow, never a public HTTP endpoint.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
}
