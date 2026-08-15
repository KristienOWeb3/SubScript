import crypto from "node:crypto";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import type { EventType } from "@/lib/events/types";
import { activeArcChain } from "@/lib/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

export function resolveEnvironment(data: Record<string, unknown>): "TEST" | "LIVE" {
    if (data.environment === "LIVE" || data.environment === "TEST") {
        return data.environment as "TEST" | "LIVE";
    }
    if (typeof data.livemode === "boolean") {
        return data.livemode ? "LIVE" : "TEST";
    }
    const chainId = Number(data.chainId || data.chain_id || 0);
    if (chainId === 5042002) return "TEST";
    if (chainId === 5042001) return "LIVE";
    if (chainId > 0) return chainId === ARC_TESTNET_CHAIN_ID ? "TEST" : "LIVE";
    const isMainnet = activeArcChain.id !== ARC_TESTNET_CHAIN_ID && process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
    return isMainnet ? "LIVE" : "TEST";
}

/** Persist a subscription lifecycle delivery before attempting network I/O.
 * Bridges legacy subscription webhook dispatches to the new canonical recordMerchantEvent ledger. */
export async function dispatchDurableSubscriptionWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>,
    transitionKey: string,
): Promise<{ eventId: string; queued: number }> {
    const environment = resolveEnvironment(data);
    const eventType = event as EventType;
    const resourceType = "subscription";
    const resourceId = String(data.subscription_id || data.subscriptionId || "").replace(/^sub_/, "");
    const resourceVersion = Number(data.version || data.sequence || 1);
    const correlationId = String(data.correlation_id || data.correlationId || `corr_legacy_${crypto.randomUUID()}`);
    const causationId = data.causation_id ? String(data.causation_id) : undefined;

    const result = await recordMerchantEvent({
        merchantAddress: walletAddress,
        environment,
        eventType,
        resourceType,
        resourceId,
        resourceVersion,
        data: { ...data, environment, livemode: environment === "LIVE" },
        correlationId,
        causationId,
        transitionKey,
    });

    return { eventId: result.eventId, queued: result.queued };
}
