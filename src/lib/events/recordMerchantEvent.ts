/**
 * Unified event recording — the single entry point for all event production.
 *
 * This is the fix for:
 * - Finding 67: Events now persist regardless of endpoint existence.
 * - Finding 68: Business events are separate from delivery attempts.
 * - Finding 69: One dispatch system replaces two incompatible ones.
 * - Finding 70: Every event carries resource version and sequence.
 * - Finding 71: Events are bound to an environment (TEST/LIVE).
 * - Finding 80: No network I/O in the API path — delivery is async.
 *
 * Flow:
 * 1. Build the canonical event envelope.
 * 2. Persist one MerchantEvent row (immutable, no endpoint dependency).
 * 3. Fan out WebhookDelivery rows for matching active endpoints.
 * 4. Return immediately — no network delivery in the request path.
 * 5. The async outbox worker picks up PENDING deliveries.
 *
 * Rules:
 * - Block comments only.
 * - Never call sendWebhookRequest from this module.
 * - Pure persistence + fan-out. All I/O is database writes.
 */

import { prisma } from "@/lib/prisma";
import type { EventEnvelope, EventType, EventEnvironment } from "./types";
import { buildEvent, deterministicEventId, type BuildEventParams } from "./builders";
import type { Prisma } from "@prisma/client";

export interface RecordMerchantEventParams {
    merchantAddress: string;
    environment: EventEnvironment;
    eventType: EventType;
    resourceType: string;
    resourceId: string;
    resourceVersion: number;
    data: Record<string, unknown>;
    correlationId: string;
    causationId?: string;
    effectiveAt?: Date;
    /** Deterministic transition key for idempotent event IDs */
    transitionKey: string;
    /** Chain ID (defaults to ARC_TESTNET_CHAIN_ID) */
    chainId?: number;
    /** Mark as simulated (test clock, sandbox) */
    simulated?: boolean;
    /** Override the sequence number (defaults to resourceVersion) */
    sequence?: number;
    /** Previous resource attributes for update diffs */
    previousAttributes?: Record<string, unknown>;
}

export interface RecordMerchantEventResult {
    eventId: string;
    queued: number;
    envelope: EventEnvelope;
}

const DEFAULT_CHAIN_ID = 5042002;

/**
 * Record a canonical merchant event and fan out to active endpoints.
 *
 * This function MUST be the only way events enter the system.
 * All callers that previously used dispatchDurableSubscriptionWebhook
 * or dispatchMerchantWebhook must migrate to this function.
 */
export async function recordMerchantEvent(
    params: RecordMerchantEventParams,
): Promise<RecordMerchantEventResult> {
    const normalizedWallet = params.merchantAddress.toLowerCase();
    const chainId = params.chainId ?? DEFAULT_CHAIN_ID;
    const sequence = params.sequence ?? params.resourceVersion;

    /* Build the deterministic event ID */
    const eventId = deterministicEventId(
        normalizedWallet,
        params.eventType,
        params.transitionKey,
    );

    /* Build the canonical envelope */
    const envelope = buildEvent({
        eventType: params.eventType,
        environment: params.environment,
        chainId,
        resource: {
            type: params.resourceType,
            id: params.resourceId,
            version: params.resourceVersion,
        },
        sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        previousAttributes: params.previousAttributes,
        effectiveAt: params.effectiveAt,
        simulated: params.simulated,
        eventId,
    });

    /* Step 1: Persist the canonical event — independent of endpoints.
       skipDuplicates handles idempotent retries. */
    const now = new Date();
    try {
        await prisma.merchantEvent.create({
            data: {
                eventId,
                merchantAddress: normalizedWallet,
                environment: params.environment,
                apiVersion: envelope.api_version,
                eventType: params.eventType,
                resourceType: params.resourceType,
                resourceId: params.resourceId,
                resourceVersion: params.resourceVersion,
                sequenceNumber: sequence,
                correlationId: params.correlationId,
                causationId: params.causationId ?? null,
                effectiveAt: params.effectiveAt ?? now,
                occurredAt: now,
                payload: envelope as unknown as Prisma.InputJsonValue,
            },
        });
    } catch (error) {
        const dbError = error as { code?: string };
        /* P2002 = unique constraint violation — this event was already recorded (idempotent) */
        if (dbError.code === "P2002") {
            /* Event already exists — still need to fan out to any new endpoints */
        } else {
            throw error;
        }
    }

    /* Step 2: Fan out to matching active endpoints.
       Endpoints must match environment. If enabledEvents is non-empty,
       the event type must be in the list. */
    const endpoints = await prisma.webhookEndpoint.findMany({
        where: {
            walletAddress: normalizedWallet,
            active: true,
            status: "ACTIVE",
            environment: params.environment,
            OR: [
                { enabledEvents: { isEmpty: true } },
                { enabledEvents: { has: params.eventType } },
            ],
        },
        select: { id: true },
    });

    if (endpoints.length === 0) {
        return { eventId, queued: 0, envelope };
    }

    /* Step 3: Create delivery jobs. skipDuplicates ensures idempotency
       when this event was already fanned out to these endpoints. */
    await prisma.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({
            webhookEndpointId: endpoint.id,
            eventId,
            event: params.eventType,
            status: "PENDING",
            payload: envelope as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
    });

    /* Step 4: Return immediately. No network I/O.
       The async outbox worker will pick up PENDING deliveries. */
    return { eventId, queued: endpoints.length, envelope };
}
