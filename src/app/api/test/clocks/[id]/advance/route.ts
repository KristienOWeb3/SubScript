import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateTestKey, serializeClock } from "@/lib/testClocks";
import { dispatchMerchantWebhook } from "@/lib/webhookDispatch";
import { subscriptionWebhookData } from "@/lib/webhooks";

/* POST /api/test/clocks/:id/advance  { days? | seconds? }
 *
 * Jump the clock forward. Every simulated subscription fires one signed
 * `subscription.renewed` webhook per billing period that becomes due — delivered to the
 * merchant's real (test) endpoints and recorded in the webhook_events ledger, so both the
 * dashboard inspector and `subscript listen` see them. Payloads carry `simulated: true`
 * and the clock id so handlers can never mistake them for real settlement. */

const MAX_ADVANCE_SECONDS = 365 * 24 * 60 * 60;
const MAX_EVENTS_PER_ADVANCE = 50;

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authenticateTestKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const clock = await prisma.testClock.findFirst({
        where: { id, merchantAddress: auth.merchantAddress },
        include: { subscriptions: true },
    });
    if (!clock) return NextResponse.json({ error: "Test clock not found." }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    let advanceSeconds = 0;
    if (body?.seconds !== undefined) advanceSeconds = Number(body.seconds);
    else if (body?.days !== undefined) advanceSeconds = Number(body.days) * 86_400;
    if (!Number.isFinite(advanceSeconds) || advanceSeconds <= 0) {
        return NextResponse.json({ error: "Pass { days } or { seconds } greater than zero." }, { status: 400 });
    }
    if (advanceSeconds > MAX_ADVANCE_SECONDS) {
        return NextResponse.json({ error: "Maximum advance is 365 days per call." }, { status: 400 });
    }

    const newFrozenTime = new Date(clock.frozenTime.getTime() + advanceSeconds * 1000);
    const fired: Array<{ subscriptionId: string; name: string; renewals: number; dispatched: number }> = [];
    let totalEvents = 0;
    let truncated = false;

    for (const sub of clock.subscriptions) {
        const intervalMs = Number(sub.intervalSeconds) * 1000;
        const anchor = (sub.lastRenewedAt || sub.startedAt).getTime();
        let dueCount = Math.floor((newFrozenTime.getTime() - anchor) / intervalMs);
        if (dueCount <= 0) continue;

        if (totalEvents + dueCount > MAX_EVENTS_PER_ADVANCE) {
            dueCount = Math.max(0, MAX_EVENTS_PER_ADVANCE - totalEvents);
            truncated = true;
        }
        if (dueCount === 0) break;

        let dispatched = 0;
        for (let i = 1; i <= dueCount; i++) {
            const renewedAt = new Date(anchor + i * intervalMs);
            const res = await dispatchMerchantWebhook(auth.merchantAddress, "subscription.renewed", {
                ...subscriptionWebhookData({
                    subscriptionId: `clock_${sub.id.slice(0, 8)}_${sub.renewalsFired + i}`,
                    status: "active",
                    amountUsdcMicros: sub.amountUsdcMicros,
                    subscriber: sub.subscriberLabel,
                    merchantAddress: auth.merchantAddress,
                }),
                simulated: true,
                test_clock_id: clock.id,
                testClockId: clock.id,
                simulated_period_end: renewedAt.toISOString(),
            }).catch(() => ({ dispatched: 0 }));
            dispatched += res.dispatched;
        }

        await prisma.testClockSubscription.update({
            where: { id: sub.id },
            data: {
                lastRenewedAt: new Date(anchor + dueCount * intervalMs),
                renewalsFired: sub.renewalsFired + dueCount,
            },
        });
        fired.push({ subscriptionId: sub.id, name: sub.name, renewals: dueCount, dispatched });
        totalEvents += dueCount;
    }

    const updated = await prisma.testClock.update({
        where: { id: clock.id },
        data: { frozenTime: newFrozenTime },
        include: { subscriptions: true },
    });

    return NextResponse.json({
        success: true,
        advancedSeconds: advanceSeconds,
        eventsFired: totalEvents,
        truncated,
        note: truncated ? `Capped at ${MAX_EVENTS_PER_ADVANCE} events per advance — advance again to continue.` : undefined,
        renewals: fired,
        clock: serializeClock(updated),
    });
}
