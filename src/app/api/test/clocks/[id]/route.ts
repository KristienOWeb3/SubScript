import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateTestKey, serializeClock } from "@/lib/testClocks";

/* GET    /api/test/clocks/:id → fetch one clock (with subscriptions)
 * DELETE /api/test/clocks/:id → delete a clock and its simulated subscriptions */

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const clock = await prisma.testClock.findFirst({
        where: { id, merchantAddress: auth.merchantAddress },
        include: { subscriptions: true },
    });
    if (!clock) return NextResponse.json({ error: "Test clock not found." }, { status: 404 });
    return NextResponse.json({ success: true, clock: serializeClock(clock) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const clock = await prisma.testClock.findFirst({ where: { id, merchantAddress: auth.merchantAddress } });
    if (!clock) return NextResponse.json({ error: "Test clock not found." }, { status: 404 });

    await prisma.testClock.delete({ where: { id: clock.id } });
    return NextResponse.json({ success: true, deleted: clock.id });
}
