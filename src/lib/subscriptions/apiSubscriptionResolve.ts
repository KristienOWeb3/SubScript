/**
 * Resolve one subscription from either public id space.
 *
 * `/api/v1/subscriptions` hands out two kinds of id and used to accept only one of them: the list
 * returns `sub_<uuid>` (a checkout session) while `?id=` accepted only `sub_<decimal>` (a PSA id).
 * That made `subscriptions.retrieve(listed.id)` in the published SDK a guaranteed 400. Both spaces
 * resolve here so the collection route and `/{id}` cannot disagree about which ids exist.
 *
 * Returns a discriminated result rather than a NextResponse so it stays independent of the route
 * layer and testable on its own.
 */

import { createPublicClient } from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { prisma } from "@/lib/prisma";
import {
    serializeApiSubscription,
    serializeOnChainSubscription,
    type PsaSubscriptionStruct,
} from "@/lib/subscriptions/apiSubscriptionView";
import {
    loadMirrorForCheckout,
    loadMirrorForSubscriptionId,
} from "@/lib/subscriptions/apiSubscriptionLookup";

export const PSA_SUBSCRIPTION_ABI = [
    {
        inputs: [],
        name: "nextSubscriptionId",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "uint256" }],
        name: "subscriptions",
        outputs: [
            { name: "subscriber", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" },
            { name: "nextPayment", type: "uint256" },
            { name: "isActive", type: "bool" },
        ],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const psaClient = createPublicClient({ chain: activeArcChain, transport: arcHttp() });

/* Only a full decimal id. parseInt would accept "123abc" as 123 and read a different subscription. */
const DECIMAL_ID = /^[1-9]\d*$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedApiSubscription =
    | { ok: true; subscription: Record<string, unknown> }
    | { ok: false; status: number; error: string };

/** Read the PSA struct for one id. Null on a revert or transient RPC failure. */
export async function readPsaSubscription(subscriptionId: bigint): Promise<PsaSubscriptionStruct | null> {
    try {
        const struct = await psaClient.readContract({
            address: STANDARD_CONTRACT_ADDRESS,
            abi: PSA_SUBSCRIPTION_ABI,
            functionName: "subscriptions",
            args: [subscriptionId],
        });
        const [subscriber, merchant, amount, period, nextPayment, isActive] = struct;
        return { subscriber, merchant, amount, period, nextPayment, isActive };
    } catch (err) {
        console.error(`[v1/subscriptions] PSA read failed for id ${subscriptionId}:`, err);
        return null;
    }
}

export async function resolveApiSubscription({
    merchantAddress,
    id,
}: {
    merchantAddress: string;
    id: string;
}): Promise<ResolvedApiSubscription> {
    const rawId = id.trim().replace(/^sub_/, "");

    if (DECIMAL_ID.test(rawId)) {
        const subscriptionId = BigInt(rawId);
        const chain = await readPsaSubscription(subscriptionId);
        if (!chain) {
            return { ok: false, status: 404, error: "Subscription not found on-chain" };
        }
        if (chain.merchant.toLowerCase() !== merchantAddress) {
            return {
                ok: false,
                status: 403,
                error: "Forbidden: This subscription does not belong to your merchant wallet",
            };
        }
        const mirror = await loadMirrorForSubscriptionId(merchantAddress, subscriptionId);
        return { ok: true, subscription: serializeOnChainSubscription({ subscriptionId, chain, mirror }) };
    }

    if (UUID_ID.test(rawId)) {
        /* Lowercased because Postgres renders uuid values lowercase and the mirror's
           sourceCheckoutId is normalized the same way. */
        const checkoutId = rawId.toLowerCase();
        const link = await prisma.paymentLink.findUnique({ where: { id: checkoutId } });
        /* One 404 for "no such checkout" and "belongs to another merchant" — distinguishing them
           would let a caller enumerate other merchants' ids. */
        if (!link || link.merchantAddress.toLowerCase() !== merchantAddress) {
            return { ok: false, status: 404, error: "Subscription not found for this merchant" };
        }
        const mirror = await loadMirrorForCheckout(merchantAddress, checkoutId);
        const subscription = serializeApiSubscription({ link, mirror });
        if (!subscription) {
            return { ok: false, status: 404, error: "Subscription not found for this merchant" };
        }
        return { ok: true, subscription };
    }

    return {
        ok: false,
        status: 400,
        error: "Bad Request: id must be sub_<number> for an on-chain subscription or sub_<uuid> for a checkout session",
    };
}
