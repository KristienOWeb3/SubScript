/* Sandbox test clocks: simulate the recurring-billing pipeline without waiting real time
 * or touching the chain. TEST-MODE API keys only — a live key must never drive simulated
 * events into a merchant's production webhook stream by accident.
 *
 * v1 deliberately simulates the delivery pipeline (signed webhooks + the webhook_events
 * ledger that both the dashboard inspector and `subscript listen` read) rather than
 * time-traveling real on-chain subscriptions: what integrators need to test is their
 * handler, and the contract clock cannot be moved on a shared network anyway.
 */
import { prisma } from "@/lib/prisma";
import { hashSecretKey } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";

export async function authenticateTestKey(request: Request): Promise<
    | { ok: true; merchantAddress: string }
    | { ok: false; status: number; error: string }
> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, error: "Pass 'Authorization: Bearer sk_test_...' — test clocks require a TEST-mode key." };
    }
    const secretKey = authHeader.substring(7).trim();
    const mode = getSecretKeyMode(secretKey);
    if (mode !== "test") {
        return { ok: false, status: 403, error: "Test clocks are sandbox-only: use an sk_test_ key, never a live key." };
    }
    const keyRecord = await prisma.apiKey.findFirst({
        where: {
            revoked: false,
            secretKeyHash: hashSecretKey(secretKey),
        },
    });
    if (!keyRecord) {
        return { ok: false, status: 401, error: "Invalid or revoked API key." };
    }
    return { ok: true, merchantAddress: keyRecord.walletAddress.toLowerCase() };
}

export function serializeClock(clock: {
    id: string;
    name: string;
    frozenTime: Date;
    createdAt: Date;
    subscriptions?: Array<{
        id: string;
        name: string;
        amountUsdcMicros: bigint;
        intervalSeconds: bigint;
        subscriberLabel: string;
        startedAt: Date;
        lastRenewedAt: Date | null;
        renewalsFired: number;
    }>;
}) {
    return {
        id: clock.id,
        name: clock.name,
        frozenTime: clock.frozenTime.toISOString(),
        createdAt: clock.createdAt.toISOString(),
        subscriptions: (clock.subscriptions || []).map((s) => ({
            id: s.id,
            name: s.name,
            amountUsdcMicros: s.amountUsdcMicros.toString(),
            intervalSeconds: s.intervalSeconds.toString(),
            subscriberLabel: s.subscriberLabel,
            startedAt: s.startedAt.toISOString(),
            lastRenewedAt: s.lastRenewedAt ? s.lastRenewedAt.toISOString() : null,
            renewalsFired: s.renewalsFired,
        })),
    };
}
