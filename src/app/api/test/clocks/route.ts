import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateTestKey, serializeClock } from "@/lib/testClocks";

/* POST /api/test/clocks  { name? }        → create a test clock frozen at "now"
 * GET  /api/test/clocks                    → list this merchant's clocks (with subscriptions)
 * Test-mode API keys only. See src/lib/testClocks.ts for the design rationale. */

const MAX_CLOCKS_PER_MERCHANT = 10;

export async function POST(request: Request) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "test clock";

    const count = await prisma.testClock.count({ where: { merchantAddress: auth.merchantAddress } });
    if (count >= MAX_CLOCKS_PER_MERCHANT) {
        return NextResponse.json({ error: `Limit of ${MAX_CLOCKS_PER_MERCHANT} test clocks reached — delete one first (DELETE /api/test/clocks/:id).` }, { status: 409 });
    }

    const clock = await prisma.testClock.create({
        data: { merchantAddress: auth.merchantAddress, name },
        include: { subscriptions: true },
    });
    return NextResponse.json({ success: true, clock: serializeClock(clock) }, { status: 201 });
}

export async function GET(request: Request) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const clocks = await prisma.testClock.findMany({
        where: { merchantAddress: auth.merchantAddress },
        include: { subscriptions: true },
        orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, clocks: clocks.map(serializeClock) });
}
