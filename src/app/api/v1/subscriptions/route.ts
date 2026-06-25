import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { hashSecretKey } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { generateReceiptId } from "@/lib/arc/memo";
import { sanitizeInput } from "@/utils/security";
import { dispatchMerchantWebhook } from "@/lib/webhookDispatch";
import { subscriptionWebhookData } from "@/lib/webhooks";

const SUBSCRIPT_ABI = [
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

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

const NAMED_INTERVAL_SECONDS: Record<string, number> = {
    daily: 86_400,
    weekly: 604_800,
    monthly: 2_592_000,
    yearly: 31_536_000,
};

type SubscriptionMeta = {
    kind: "subscription";
    intervalSeconds: number;
    intervalCount: number;
    interval: string | null;
    subscriber: string | null;
    planId: string | null;
};

/* Accepts a session cookie or a Bearer sk_test_/sk_live_ key. Returns the merchant wallet
   (lowercased) plus whether the request is in test/sandbox mode. */
async function authenticateMerchant(request: Request): Promise<
    { ok: true; merchantAddress: string; mode: "test" | "live" | "session" } | { ok: false; status: number; error: string }
> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { ok: true, merchantAddress: sessionWallet.toLowerCase(), mode: "session" };
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, error: "Unauthorized: Missing or invalid Authorization header" };
    }
    const secretKey = authHeader.substring(7).trim();
    const mode = getSecretKeyMode(secretKey);
    if (mode !== "test" && mode !== "live") {
        return { ok: false, status: 401, error: "Unauthorized: Invalid secret API key format" };
    }
    const keyRecord = await prisma.apiKey.findFirst({
        where: { revoked: false, OR: [{ secretKeyHash: hashSecretKey(secretKey) }, { secretKeyPlain: secretKey }] },
    });
    if (!keyRecord) {
        return { ok: false, status: 401, error: "Unauthorized: Active secret key not found" };
    }
    return { ok: true, merchantAddress: keyRecord.walletAddress.toLowerCase(), mode };
}

function microsToDecimal(micros: bigint) {
    return formatUnits(micros, 6);
}

function readSubscriptionMeta(stateSnapshot: unknown): SubscriptionMeta | null {
    const sub = (stateSnapshot as { subscription?: SubscriptionMeta } | null)?.subscription;
    return sub && sub.kind === "subscription" ? sub : null;
}

/* ----------------------------------- GET ----------------------------------- */
/* - ?id=sub_<n>         -> read a single on-chain subscription
   - ?subscriber=0x...   -> list on-chain subscriptions for that subscriber under this merchant
   - (no params)         -> list this merchant's subscription checkout sessions (created via POST) */
export async function GET(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const merchantWallet = auth.merchantAddress;

        const { searchParams } = new URL(request.url);
        const subIdParam = searchParams.get("id");
        const subscriberParam = searchParams.get("subscriber");

        if (subIdParam) {
            /* Accept only a full decimal id after the sub_ prefix — parseInt would silently
               accept "sub_123abc" as 123 and read a different subscription. */
            const rawSubId = subIdParam.replace(/^sub_/, "");
            if (!/^[1-9]\d*$/.test(rawSubId)) {
                return NextResponse.json({ error: "Bad Request: Invalid subscription ID format" }, { status: 400 });
            }
            const subId = BigInt(rawSubId);
            try {
                const sub = await publicClient.readContract({
                    address: STANDARD_CONTRACT_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "subscriptions",
                    args: [subId],
                });
                const [subscriber, merchant, amount, period, nextPayment, isActive] = sub;
                if (merchant.toLowerCase() !== merchantWallet) {
                    return NextResponse.json({ error: "Forbidden: This subscription does not belong to your merchant wallet" }, { status: 403 });
                }
                return NextResponse.json({
                    id: `sub_${subId}`,
                    object: "subscription",
                    subscriber,
                    merchant,
                    amountUsdc: microsToDecimal(amount),
                    amountUsdcMicros: amount.toString(),
                    periodSeconds: Number(period),
                    nextPaymentTimestamp: Number(nextPayment),
                    nextPaymentDate: new Date(Number(nextPayment) * 1000).toISOString(),
                    status: isActive ? "active" : "inactive",
                    isActive,
                }, { status: 200 });
            } catch (err: any) {
                console.error(`Error reading subId ${subId} from contract:`, err);
                return NextResponse.json({ error: "Subscription not found on-chain" }, { status: 404 });
            }
        }

        if (subscriberParam) {
            const subscriberWallet = subscriberParam.toLowerCase();
            if (!subscriberWallet.startsWith("0x") || subscriberWallet.length !== 42) {
                return NextResponse.json({ error: "Bad Request: Invalid subscriber address" }, { status: 400 });
            }
            try {
                /* Indexer-backed: select candidate ids from the subscriptions mirror (indexed by
                   merchant + subscriber) rather than scanning every on-chain id, then read only
                   those from chain for authoritative amount/status. Bounded — scales with a
                   subscriber's own subscriptions, not the whole contract. */
                const rows = await prisma.subscription.findMany({
                    where: { merchantAddress: merchantWallet, subscriber: subscriberWallet },
                    select: { subscriptionId: true },
                    orderBy: { subscriptionId: "desc" },
                    take: 100,
                });
                const subscriptions = (await Promise.all(rows.map(async ({ subscriptionId }: { subscriptionId: bigint }) => {
                    try {
                        const data = await publicClient.readContract({
                            address: STANDARD_CONTRACT_ADDRESS,
                            abi: SUBSCRIPT_ABI,
                            functionName: "subscriptions",
                            args: [subscriptionId],
                        });
                        const [subPayer, subMerchant, amount, period, nextPayment, isActive] = data;
                        if (subPayer.toLowerCase() !== subscriberWallet || subMerchant.toLowerCase() !== merchantWallet) {
                            return null;
                        }
                        return {
                            id: `sub_${subscriptionId}`,
                            object: "subscription" as const,
                            subscriber: subPayer,
                            merchant: subMerchant,
                            amountUsdc: microsToDecimal(amount),
                            amountUsdcMicros: amount.toString(),
                            periodSeconds: Number(period),
                            nextPaymentTimestamp: Number(nextPayment),
                            nextPaymentDate: new Date(Number(nextPayment) * 1000).toISOString(),
                            status: isActive ? "active" : "inactive",
                            isActive,
                        };
                    } catch {
                        return null;
                    }
                }))).filter((s): s is NonNullable<typeof s> => s !== null);
                return NextResponse.json({ object: "list", data: subscriptions }, { status: 200 });
            } catch (err: any) {
                console.error("Error listing subscriptions for subscriber:", err);
                return NextResponse.json({ error: "Failed to list subscriptions" }, { status: 500 });
            }
        }

        /* No params: list this merchant's subscription checkout sessions created via POST.
           Filter on the subscription metadata in the query so one-time intents can't push
           older subscriptions out of the take:100 window. */
        const links = await prisma.paymentLink.findMany({
            where: {
                merchantAddress: merchantWallet,
                stateSnapshot: { path: ["subscription", "kind"], equals: "subscription" },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
        const data = links
            .map((link: any) => ({ link, meta: readSubscriptionMeta(link.stateSnapshot) }))
            .filter((x: any) => x.meta)
            .map(({ link, meta }: any) => ({
                id: `sub_${link.id}`,
                object: "subscription",
                status: link.status === "PAID" ? "active" : link.active ? "incomplete" : "canceled",
                merchantAddress: link.merchantAddress,
                subscriber: meta.subscriber || null,
                amountUsdc: microsToDecimal(link.amountUsdc),
                amountUsdcMicros: link.amountUsdc.toString(),
                intervalSeconds: meta.intervalSeconds,
                intervalCount: meta.intervalCount,
                interval: meta.interval || null,
                checkoutUrl: buildCheckoutUrl(link.id),
                createdAt: link.createdAt,
            }));
        return NextResponse.json({ object: "list", data }, { status: 200 });
    } catch (error: any) {
        console.error("Subscriptions GET error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/* ----------------------------------- POST ---------------------------------- */
/* Create a subscription. Because a SubScript subscription is an on-chain authorization, this
   returns an `incomplete` subscription with a `checkoutUrl` the subscriber completes on-chain;
   it becomes `active` once activation settles. Body: { amountUsdcMicros | amountUsdc | planId,
   interval | intervalSeconds, intervalCount?, subscriber?, title?, externalReference?,
   idempotencyKey?, sandbox? }. */
export async function POST(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const merchantAddress = auth.merchantAddress;

        const raw = await request.json().catch(() => null);
        if (!raw || typeof raw !== "object") {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }
        const body = sanitizeInput(raw);
        const {
            amountUsdc, amountUsdcMicros, planId,
            interval, intervalSeconds, intervalCount,
            subscriber, title, externalReference, idempotencyKey, sandbox,
        } = body;
        const isSandbox = sandbox === true || auth.mode === "test";

        // 1. Resolve amount + period (a plan supplies both).
        let amountMicros: bigint | null = null;
        let periodSeconds: number | null = null;
        let resolvedInterval: string | null = null;

        if (planId) {
            const plan = await prisma.merchantPlan.findFirst({ where: { id: String(planId), merchantAddress, active: true } });
            if (!plan) return NextResponse.json({ error: "Bad Request: plan not found for this merchant" }, { status: 404 });
            amountMicros = plan.amountUsdc;
            periodSeconds = Number(plan.periodSeconds);
        }

        if (amountMicros === null) {
            /* Validate before converting: legacy `amountUsdc` like "abc"/"Infinity" must 400, not 500. */
            let source: string | null = null;
            if (amountUsdcMicros !== undefined && amountUsdcMicros !== null && amountUsdcMicros !== "") {
                source = String(amountUsdcMicros).trim();
            } else if (amountUsdc !== undefined && amountUsdc !== null && amountUsdc !== "") {
                const decimal = String(amountUsdc).trim();
                if (!/^\d+(\.\d{1,6})?$/.test(decimal)) {
                    return NextResponse.json({ error: "Bad Request: invalid amountUsdc" }, { status: 400 });
                }
                const [whole, fraction = ""] = decimal.split(".");
                source = `${whole}${fraction.padEnd(6, "0")}`;
            }
            if (source === null) {
                return NextResponse.json({ error: "Bad Request: provide planId, amountUsdcMicros, or amountUsdc" }, { status: 400 });
            }
            if (!/^\d+$/.test(source)) {
                return NextResponse.json({ error: "Bad Request: invalid amountUsdcMicros" }, { status: 400 });
            }
            amountMicros = BigInt(source);
        }
        if (amountMicros <= BigInt(0)) {
            return NextResponse.json({ error: "Bad Request: amount must be greater than 0" }, { status: 400 });
        }

        if (periodSeconds === null) {
            if (typeof interval === "string" && interval in NAMED_INTERVAL_SECONDS) {
                periodSeconds = NAMED_INTERVAL_SECONDS[interval];
                resolvedInterval = interval;
            } else if (intervalSeconds !== undefined && intervalSeconds !== null && Number.isInteger(Number(intervalSeconds)) && Number(intervalSeconds) > 0) {
                periodSeconds = Number(intervalSeconds);
            } else {
                return NextResponse.json({ error: "Bad Request: provide interval (daily|weekly|monthly|yearly) or a positive intervalSeconds" }, { status: 400 });
            }
        }

        const count = intervalCount !== undefined && intervalCount !== null && intervalCount !== ""
            ? Number(intervalCount) : 1;
        if (!Number.isInteger(count) || count <= 0 || count > 365) {
            return NextResponse.json({ error: "Bad Request: intervalCount must be a positive integer (<=365)" }, { status: 400 });
        }

        let subscriberAddress: string | null = null;
        if (subscriber !== undefined && subscriber !== null && subscriber !== "") {
            if (typeof subscriber !== "string" || !subscriber.startsWith("0x") || subscriber.length !== 42) {
                return NextResponse.json({ error: "Bad Request: invalid subscriber address" }, { status: 400 });
            }
            subscriberAddress = subscriber.toLowerCase();
        }

        if (externalReference !== undefined && externalReference !== null &&
            (typeof externalReference !== "string" || externalReference.length > 256)) {
            return NextResponse.json({ error: "Bad Request: externalReference must be a string up to 256 characters" }, { status: 400 });
        }

        // 2. Idempotency: return the existing subscription if the key was already used.
        if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
            const existing = await prisma.paymentLink.findFirst({ where: { idempotencyKey, merchantAddress } });
            if (existing) {
                const meta = readSubscriptionMeta(existing.stateSnapshot);
                /* Reject if the same key was used for a one-time intent (different resource shape). */
                if (!meta) {
                    return NextResponse.json({ error: "Conflict: idempotencyKey was used for a different resource" }, { status: 409 });
                }
                return NextResponse.json({
                    success: true,
                    subscription: {
                        id: `sub_${existing.id}`,
                        object: "subscription",
                        status: existing.status === "PAID" ? "active" : existing.active ? "incomplete" : "canceled",
                        merchantAddress: existing.merchantAddress,
                        subscriber: meta?.subscriber || null,
                        amountUsdcMicros: existing.amountUsdc.toString(),
                        amountUsdc: microsToDecimal(existing.amountUsdc),
                        intervalSeconds: meta?.intervalSeconds ?? periodSeconds,
                        intervalCount: meta?.intervalCount ?? count,
                        interval: meta?.interval ?? resolvedInterval,
                        checkoutUrl: buildCheckoutUrl(existing.id),
                        createdAt: existing.createdAt,
                    },
                }, { status: 200 });
            }
        }

        // 3. Create the subscription checkout session (PaymentLink + subscription metadata).
        const subMeta: SubscriptionMeta = {
            kind: "subscription",
            intervalSeconds: periodSeconds,
            intervalCount: count,
            interval: resolvedInterval,
            subscriber: subscriberAddress,
            planId: planId ? String(planId) : null,
        };
        const link = await prisma.paymentLink.create({
            data: {
                merchantAddress,
                title: (typeof title === "string" && title.trim()) ? title.trim() : "Subscription",
                amountUsdc: amountMicros,
                active: true,
                status: "PENDING",
                externalReference: externalReference || null,
                idempotencyKey: (idempotencyKey && String(idempotencyKey).trim()) || null,
                receiptToken: generateReceiptId("subscription"),
                stateSnapshot: { subscription: subMeta },
            },
        });

        await dispatchMerchantWebhook(merchantAddress, "subscription.created", subscriptionWebhookData({
            subscriptionId: link.id,
            status: "incomplete",
            amountUsdcMicros: amountMicros,
            subscriber: subscriberAddress,
            merchantAddress,
        })).catch(() => { /* delivery is best-effort */ });

        return NextResponse.json({
            success: true,
            subscription: {
                id: `sub_${link.id}`,
                object: "subscription",
                status: "incomplete",
                merchantAddress,
                subscriber: subscriberAddress,
                amountUsdcMicros: amountMicros.toString(),
                amountUsdc: microsToDecimal(amountMicros),
                intervalSeconds: periodSeconds,
                intervalCount: count,
                interval: resolvedInterval,
                checkoutUrl: buildCheckoutUrl(link.id),
                createdAt: link.createdAt,
            },
            sandbox: isSandbox,
        }, { status: 201 });
    } catch (error: any) {
        console.error("Subscriptions POST error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

/* ---------------------------------- DELETE --------------------------------- */
/* Cancel a subscription by id.
   - sub_<uuid>   -> cancels a checkout session that hasn't activated yet
   - sub_<number> -> flags the on-chain subscription to cancel at period end */
export async function DELETE(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const merchantAddress = auth.merchantAddress;

        const { searchParams } = new URL(request.url);
        const idParam = (searchParams.get("id") || "").replace(/^sub_/, "");
        if (!idParam) {
            return NextResponse.json({ error: "Bad Request: missing subscription id" }, { status: 400 });
        }

        // On-chain subscription id (numeric): flag cancel-at-period-end on the mirror row.
        if (/^\d+$/.test(idParam)) {
            const subscriptionId = BigInt(idParam);
            const existing = await prisma.subscription.findUnique({ where: { subscriptionId } });
            if (!existing || existing.merchantAddress.toLowerCase() !== merchantAddress) {
                return NextResponse.json({ error: "Subscription not found for this merchant" }, { status: 404 });
            }
            const updated = await prisma.subscription.update({
                where: { subscriptionId },
                data: { cancelAtPeriodEnd: true, cancelRequestedAt: new Date() },
            });
            await dispatchMerchantWebhook(merchantAddress, "subscription.canceled", subscriptionWebhookData({
                subscriptionId: idParam,
                status: "canceled",
                subscriber: existing.subscriber,
                merchantAddress,
                reason: "Cancel requested at period end",
            })).catch(() => { /* delivery is best-effort */ });
            return NextResponse.json({
                id: `sub_${idParam}`,
                object: "subscription",
                status: "active",
                cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
            }, { status: 200 });
        }

        // Checkout-session subscription (uuid): cancel it only if it hasn't activated on-chain.
        const link = await prisma.paymentLink.findUnique({ where: { id: idParam } });
        if (!link || link.merchantAddress.toLowerCase() !== merchantAddress || !readSubscriptionMeta(link.stateSnapshot)) {
            return NextResponse.json({ error: "Subscription not found for this merchant" }, { status: 404 });
        }
        if (link.status === "PAID") {
            return NextResponse.json({ error: "Conflict: active subscriptions must be canceled by on-chain subscription id" }, { status: 409 });
        }
        await prisma.paymentLink.update({
            where: { id: idParam },
            data: { active: false, status: "CANCELED" },
        });
        await dispatchMerchantWebhook(merchantAddress, "subscription.canceled", subscriptionWebhookData({
            subscriptionId: idParam,
            status: "canceled",
            amountUsdcMicros: link.amountUsdc,
            merchantAddress,
            reason: "Canceled before activation",
        })).catch(() => { /* delivery is best-effort */ });
        return NextResponse.json({ id: `sub_${idParam}`, object: "subscription", status: "canceled" }, { status: 200 });
    } catch (error: any) {
        console.error("Subscriptions DELETE error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
