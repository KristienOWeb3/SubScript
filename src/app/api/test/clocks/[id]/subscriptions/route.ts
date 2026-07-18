import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateTestKey, serializeClock } from "@/lib/testClocks";

/* POST /api/test/clocks/:id/subscriptions
 *   { name?, amountUsdcMicros | amountUsdc, interval? (daily|weekly|monthly|yearly) | intervalSeconds, subscriberLabel? }
 * Attach a simulated subscription to a test clock. Renewal events fire when the clock advances. */

const INTERVALS: Record<string, number> = {
    daily: 86_400,
    weekly: 604_800,
    monthly: 2_592_000,
    yearly: 31_536_000,
};
const MAX_SUBS_PER_CLOCK = 20;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const clock = await prisma.testClock.findFirst({ where: { id, merchantAddress: auth.merchantAddress } });
    if (!clock) return NextResponse.json({ error: "Test clock not found." }, { status: 404 });

    const count = await prisma.testClockSubscription.count({ where: { clockId: clock.id } });
    if (count >= MAX_SUBS_PER_CLOCK) {
        return NextResponse.json({ error: `Limit of ${MAX_SUBS_PER_CLOCK} simulated subscriptions per clock reached.` }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));

    let amountUsdcMicros: bigint;
    try {
        if (body?.amountUsdcMicros !== undefined) {
            amountUsdcMicros = BigInt(String(body.amountUsdcMicros));
        } else if (body?.amountUsdc !== undefined) {
            amountUsdcMicros = BigInt(Math.round(Number(body.amountUsdc) * 1_000_000));
        } else {
            amountUsdcMicros = BigInt(10_000_000); /* 10 USDC default */
        }
    } catch {
        return NextResponse.json({ error: "amountUsdcMicros must be an integer string (1 USDC = 1000000)." }, { status: 400 });
    }
    if (amountUsdcMicros <= BigInt(0)) {
        return NextResponse.json({ error: "Amount must be positive." }, { status: 400 });
    }

    let intervalSeconds: number;
    if (typeof body?.interval === "string" && INTERVALS[body.interval]) {
        intervalSeconds = INTERVALS[body.interval];
    } else if (body?.intervalSeconds !== undefined) {
        intervalSeconds = Number(body.intervalSeconds);
    } else {
        intervalSeconds = INTERVALS.monthly;
    }
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 60) {
        return NextResponse.json({ error: "intervalSeconds must be at least 60." }, { status: 400 });
    }

    const sub = await prisma.testClockSubscription.create({
        data: {
            clockId: clock.id,
            name: typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "test subscription",
            amountUsdcMicros,
            intervalSeconds: BigInt(intervalSeconds),
            subscriberLabel: typeof body?.subscriberLabel === "string" && body.subscriberLabel.trim()
                ? body.subscriberLabel.trim().slice(0, 64)
                : "0xtest0000000000000000000000000000subscriber",
            startedAt: clock.frozenTime,
        },
    });

    const fresh = await prisma.testClock.findUnique({ where: { id: clock.id }, include: { subscriptions: true } });
    return NextResponse.json({ success: true, subscriptionId: sub.id, clock: fresh ? serializeClock(fresh) : null }, { status: 201 });
}
