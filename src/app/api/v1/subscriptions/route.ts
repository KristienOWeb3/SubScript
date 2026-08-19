import { NextResponse } from "next/server";
import { ProtocolConfig } from "@/lib/payments/config";
import {
    ARC_TESTNET_CHAIN_ID,
    DEMO_MERCHANT_ADDRESS,
} from "@/lib/contracts/constants";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiErrors";
import { authenticateMerchant, requireEnterpriseAndPremium } from "@/lib/v1/merchantAuth";
import { buildSubscribeUrl } from "@/lib/checkoutUrl";
import { generateReceiptId } from "@/lib/arc/memo";
import { sanitizeInput } from "@/utils/security";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { onActiveContract } from "@/lib/subscriptions/contractBinding";
import {
    readSubscriptionCheckoutMeta,
    subscriptionCheckoutPeriod,
    type SubscriptionCheckoutMeta,
} from "@/lib/subscriptionCheckout";
import {
    API_SUBSCRIPTION_STATUSES,
    CHECKOUT_EXPIRY_SECONDS,
    microsToDecimal,
    serializeApiSubscription,
    serializeOnChainSubscription,
    type ApiSubscriptionStatus,
} from "@/lib/subscriptions/apiSubscriptionView";
import {
    loadMirrorForCheckout,
    loadMirrorsForCheckouts,
    loadMirrorsForSubscriptionIds,
} from "@/lib/subscriptions/apiSubscriptionLookup";
import { readPsaSubscription, resolveApiSubscription } from "@/lib/subscriptions/apiSubscriptionResolve";
import {
    checkoutHasPrivatePlanTerms,
    createCheckoutWithPublishedSitePlan,
    publishSitePlanFromCheckout,
    SitePlanPublicationError,
} from "@/lib/subscriptions/sitePlans";
import { createSubscriptionOfferDm } from "@/lib/dms/system";
import { createDmAndNotify } from "@/lib/dms/notifications";

const NAMED_INTERVAL_SECONDS: Record<string, number> = {
    daily: 86_400,
    weekly: 604_800,
    monthly: 2_592_000,
    yearly: 31_536_000,
};

/* authenticateMerchant lives in @/lib/v1/merchantAuth (imported above) so /api/v1/plans and
   /api/v1/subscriptions share one implementation — including the TEST/LIVE mode isolation
   from PR #70 (sk_live_ refused, non-TEST keys rejected). */

/* Comma-separated ?status= filter. Unknown values are rejected rather than ignored: a typo that
   silently returns everything reads as "no subscriptions match", which is worse than an error. */
function parseStatusFilter(raw: string | null): { ok: true; statuses: Set<ApiSubscriptionStatus> | null } | { ok: false; error: string } {
    if (!raw || !raw.trim()) return { ok: true, statuses: null };
    const requested = raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const invalid = requested.filter((value) => !API_SUBSCRIPTION_STATUSES.includes(value as ApiSubscriptionStatus));
    if (invalid.length > 0) {
        return {
            ok: false,
            error: `Bad Request: unknown status ${invalid.join(", ")}. Valid values: ${API_SUBSCRIPTION_STATUSES.join(", ")}`,
        };
    }
    return { ok: true, statuses: new Set(requested as ApiSubscriptionStatus[]) };
}


/* ----------------------------------- GET ----------------------------------- */
/* - ?id=sub_<n> | sub_<uuid>  -> read a single subscription (see GET /api/v1/subscriptions/{id})
   - ?subscriber=0x...         -> list on-chain subscriptions for that subscriber under this merchant
   - (no params)               -> list this merchant's subscription checkout sessions, enriched from
                                  the subscriptions mirror. Optional ?status= and ?externalReference=. */
export async function GET(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        const merchantWallet = auth.merchantAddress;

        const { searchParams } = new URL(request.url);
        const subIdParam = searchParams.get("id");
        const subscriberParam = searchParams.get("subscriber");

        if (subIdParam) {
            /* Both id spaces resolve through the same helper as /api/v1/subscriptions/{id}, so a
               `sub_<uuid>` copied out of the list below reads back here instead of 400ing. */
            const resolved = await resolveApiSubscription({ merchantAddress: merchantWallet, id: subIdParam });
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }
            return NextResponse.json(resolved.subscription, { status: 200 });
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
                   subscriber's own subscriptions, not the whole contract. Scoped to the active PSA
                   so ids stranded by an abandoned deployment are not read from a contract that
                   never minted them. */
                const rows = await prisma.subscription.findMany({
                    where: { ...onActiveContract(), merchantAddress: merchantWallet, subscriber: subscriberWallet },
                    select: { subscriptionId: true },
                    orderBy: { subscriptionId: "desc" },
                    take: 100,
                });
                const mirrors = await loadMirrorsForSubscriptionIds(
                    merchantWallet,
                    rows.map(({ subscriptionId }: { subscriptionId: bigint }) => subscriptionId),
                );
                const subscriptions = (await Promise.all(rows.map(async ({ subscriptionId }: { subscriptionId: bigint }) => {
                    const chain = await readPsaSubscription(subscriptionId);
                    if (!chain) return null;
                    if (chain.subscriber.toLowerCase() !== subscriberWallet
                        || chain.merchant.toLowerCase() !== merchantWallet) {
                        return null;
                    }
                    return serializeOnChainSubscription({
                        subscriptionId,
                        chain,
                        mirror: mirrors.get(subscriptionId.toString()) || null,
                    });
                }))).filter((s): s is NonNullable<typeof s> => s !== null);
                return NextResponse.json({ object: "list", data: subscriptions }, { status: 200 });
            } catch (err: any) {
                console.error("Error listing subscriptions for subscriber:", err);
                return apiError({ status: 500, code: "internal_error", message: "Failed to list subscriptions. Quote the request_id when reporting this." });
            }
        }

        const statusFilter = parseStatusFilter(searchParams.get("status"));
        if (!statusFilter.ok) {
            return NextResponse.json({ error: statusFilter.error }, { status: 400 });
        }
        const referenceParam = (searchParams.get("externalReference") || searchParams.get("merchantCustomerId") || "").trim();

        /* No params: list this merchant's subscription checkout sessions created via POST.
           Filter on the subscription metadata in the query so one-time intents can't push
           older subscriptions out of the take:100 window. */
        const links = await prisma.paymentLink.findMany({
            where: {
                merchantAddress: merchantWallet,
                stateSnapshot: { path: ["subscription", "kind"], equals: "subscription" },
                ...(referenceParam ? { externalReference: referenceParam } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
        /* The join that makes the rest of this object honest. A checkout row records what was
           authorized and is never touched again when the subscription is later canceled, so
           without the mirror `status` reports canceled subscriptions as active forever, and
           currentPeriodEnd / subscriber / subscriptionId have nowhere to come from. */
        const mirrors = await loadMirrorsForCheckouts(merchantWallet, links.map((link: { id: string }) => link.id));
        const now = new Date();
        const data = links
            .map((link: any) => serializeApiSubscription({ link, mirror: mirrors.get(link.id) || null, now }))
            .filter((subscription): subscription is NonNullable<typeof subscription> => subscription !== null)
            .filter((subscription) => !statusFilter.statuses || statusFilter.statuses.has(subscription.status));
        return NextResponse.json({ object: "list", data }, { status: 200 });
    } catch (error: any) {
        console.error("Subscriptions GET error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}

/* ----------------------------------- POST ---------------------------------- */
/* Create a subscription. Because a SubScript subscription is an on-chain authorization, this
   returns an `incomplete` subscription with a `checkoutUrl` the subscriber completes on-chain;
   it becomes `active` once activation settles. Body: { amountUsdcMicros | amountUsdc | planId,
   interval | intervalSeconds, intervalCount?, subscriber?, title?, externalReference?,
   merchantCustomerId?,
   publishToDm?, idempotencyKey?, sandbox? }. */
export async function POST(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress, auth.mode);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });

        const merchantAddress = auth.merchantAddress;

        const raw = await request.json().catch(() => null);
        if (!raw || typeof raw !== "object") {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }
        const body = sanitizeInput(raw);
        const {
            amountUsdc, amountUsdcMicros, planId,
            interval, intervalSeconds, intervalCount,
            subscriber, beneficiary, title, externalReference, merchantCustomerId,
            idempotencyKey, sandbox, successUrl, cancelUrl,
            publishToDm,
        } = body;
        const isTestMode = auth.mode === "test";
        if (sandbox !== undefined && sandbox !== isTestMode) {
            return NextResponse.json({ error: "Bad Request: sandbox mode is determined by the API key" }, { status: 400 });
        }
        if (isTestMode && merchantAddress === DEMO_MERCHANT_ADDRESS.toLowerCase()) {
            return apiError({
                status: 403,
                code: "demo_key_simulation_only",
                message: "The shared public demo key cannot create a funded subscription. Create your own test key for Arc testnet settlement.",
            });
        }
        const isSandbox = isTestMode;
        if (publishToDm !== undefined && typeof publishToDm !== "boolean") {
            return NextResponse.json({ error: "Bad Request: publishToDm must be a boolean" }, { status: 400 });
        }
        // 1. Resolve amount + period (a plan supplies both).
        let amountMicros: bigint | null = null;
        let periodSeconds: number | null = null;
        let resolvedInterval: string | null = null;
        let minCommitmentSeconds = 0;

        if (planId) {
            const plan = await prisma.merchantPlan.findFirst({ where: { id: String(planId), merchantAddress, active: true } });
            if (!plan) return NextResponse.json({ error: "Bad Request: plan not found for this merchant" }, { status: 404 });
            amountMicros = plan.amountUsdc;
            periodSeconds = Number(plan.periodSeconds);
            minCommitmentSeconds = Number(plan.minCommitmentSeconds || 0);
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
            } else if (intervalSeconds !== undefined && intervalSeconds !== null && Number.isSafeInteger(Number(intervalSeconds)) && Number(intervalSeconds) > 0) {
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
            if (typeof subscriber !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(subscriber)) {
                return NextResponse.json({ error: "Bad Request: invalid subscriber address" }, { status: 400 });
            }
            subscriberAddress = subscriber.toLowerCase();
        }
        let beneficiaryAddress: string | null = null;
        if (beneficiary !== undefined && beneficiary !== null && beneficiary !== "") {
            if (typeof beneficiary !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(beneficiary)) {
                return NextResponse.json({ error: "Bad Request: invalid beneficiary address" }, { status: 400 });
            }
            beneficiaryAddress = beneficiary.toLowerCase();
        }
        if (publishToDm === true && beneficiaryAddress) {
            return NextResponse.json({
                error: "Bad Request: beneficiary-bound checkouts cannot be published as plans",
            }, { status: 400 });
        }
        const validateReturnUrl = (label: string, value: unknown) => {
            if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
            if (typeof value !== "string" || value.length > 2048) return { ok: false as const, error: `${label} must be a URL up to 2048 characters` };
            try {
                const parsed = new URL(value);
                const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
                if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) throw new Error("unsafe protocol");
                return { ok: true as const, value: parsed.toString() };
            } catch {
                return { ok: false as const, error: `${label} must be a valid https URL` };
            }
        };
        const successUrlResult = validateReturnUrl("successUrl", successUrl);
        if (!successUrlResult.ok) return NextResponse.json({ error: `Bad Request: ${successUrlResult.error}` }, { status: 400 });
        const cancelUrlResult = validateReturnUrl("cancelUrl", cancelUrl);
        if (!cancelUrlResult.ok) return NextResponse.json({ error: `Bad Request: ${cancelUrlResult.error}` }, { status: 400 });

        for (const [label, value] of [
            ["externalReference", externalReference],
            ["merchantCustomerId", merchantCustomerId],
        ] as const) {
            if (value !== undefined && value !== null
                && (typeof value !== "string" || value.trim().length === 0 || value.length > 256)) {
                return NextResponse.json({ error: `Bad Request: ${label} must be a non-empty string up to 256 characters` }, { status: 400 });
            }
        }
        const normalizedExternalReference = typeof externalReference === "string" ? externalReference.trim() : null;
        const normalizedMerchantCustomerId = typeof merchantCustomerId === "string" ? merchantCustomerId.trim() : null;
        if (normalizedExternalReference && normalizedMerchantCustomerId
            && normalizedExternalReference !== normalizedMerchantCustomerId) {
            return NextResponse.json({
                error: "Bad Request: externalReference and merchantCustomerId must match when both are provided",
            }, { status: 400 });
        }
        const merchantAccountReference = normalizedMerchantCustomerId || normalizedExternalReference;
        if (merchantAccountReference && !subscriberAddress) {
            return NextResponse.json({
                error: "Bad Request: subscriber is required when merchantCustomerId or externalReference is provided",
            }, { status: 400 });
        }
        /* API-created subscription products are catalog plans by default. `false` remains a
           backwards-compatible opt-out. Beneficiary-bound attempts stay private, while
           subscriber-assigned checkouts publish only to that wallet. */
        const shouldPublishToDm = publishToDm !== false && !beneficiaryAddress;

        // 2. Idempotency: return the existing subscription if the key was already used.
        if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
            const existing = await prisma.paymentLink.findFirst({ where: { idempotencyKey, merchantAddress } });
            if (existing) {
                const meta = readSubscriptionCheckoutMeta(existing.stateSnapshot);
                /* Reject if the same key was used for a one-time intent (different resource shape). */
                if (!meta) {
                    return NextResponse.json({ error: "Conflict: idempotencyKey was used for a different resource" }, { status: 409 });
                }
                const existingSubscriber = meta.subscriber || null;
                const existingMerchantAccount = existing.externalReference?.trim() || null;
                if (subscriberAddress !== existingSubscriber
                    || merchantAccountReference !== existingMerchantAccount) {
                    return NextResponse.json({
                        error: "Conflict: idempotencyKey was already used for a different subscriber or merchant customer/account binding",
                    }, { status: 409 });
                }
                const canPublishExisting = shouldPublishToDm && !checkoutHasPrivatePlanTerms(existing, meta);
                if (publishToDm === true && !canPublishExisting) {
                    return NextResponse.json({
                        error: "Bad Request: beneficiary-bound or invoice-specific checkouts cannot be published as plans",
                    }, { status: 400 });
                }
                const published = canPublishExisting
                    ? await publishSitePlanFromCheckout(merchantAddress, existing.id)
                    : null;
                const canonicalPlanId = published?.plan.id || meta.planId || null;
                if (canPublishExisting && meta.subscriber) {
                    await createSubscriptionOfferDm({
                        merchantAddress,
                        subscriberAddress: meta.subscriber,
                        checkoutSessionId: existing.id,
                        planName: existing.title,
                        amountUsdc: existing.amountUsdc,
                        periodSeconds: subscriptionCheckoutPeriod(meta),
                    });
                }
                /* Serialized through the shared view so a retried create returns exactly the object
                   the list and GET /{id} return — including a mirror row if the subscriber has
                   already accepted this checkout since the first call. */
                const existingMirror = await loadMirrorForCheckout(merchantAddress, existing.id);
                const existingView = serializeApiSubscription({ link: existing, mirror: existingMirror });
                return NextResponse.json({
                    success: true,
                    subscription: existingView
                        ? { ...existingView, planId: canonicalPlanId ?? existingView.planId }
                        : {
                            /* Unreachable in practice — the meta guard above already returned 409
                               for a non-subscription link. Kept so a schema change cannot turn a
                               null into a 500. */
                            id: `sub_${existing.id}`,
                            object: "subscription",
                            status: existing.status === "PAID" ? "active" : existing.active ? "incomplete" : "canceled",
                            merchantAddress: existing.merchantAddress,
                            subscriber: meta.subscriber || null,
                            amountUsdcMicros: existing.amountUsdc.toString(),
                            amountUsdc: microsToDecimal(existing.amountUsdc),
                            intervalSeconds: meta.intervalSeconds ?? periodSeconds,
                            intervalCount: meta.intervalCount ?? count,
                            interval: meta.interval ?? resolvedInterval,
                            planId: canonicalPlanId,
                            merchantCustomerId: existing.externalReference,
                            externalReference: existing.externalReference,
                            checkoutUrl: buildSubscribeUrl(existing.id),
                            createdAt: existing.createdAt,
                        },
                }, { status: 200 });
            }
        }

        // 3. Create the subscription checkout session (PaymentLink + subscription metadata).
        const subMeta: SubscriptionCheckoutMeta = {
            kind: "subscription",
            intervalSeconds: periodSeconds,
            intervalCount: count,
            interval: resolvedInterval,
            subscriber: subscriberAddress,
            beneficiary: beneficiaryAddress,
            planId: planId ? String(planId) : null,
            minCommitmentSeconds,
            successUrl: successUrlResult.value,
            cancelUrl: cancelUrlResult.value,
        };
        const checkoutExpiry = new Date(Date.now() + CHECKOUT_EXPIRY_SECONDS * 1000);
        const linkData = {
            merchantAddress,
            title: (typeof title === "string" && title.trim()) ? title.trim() : "Subscription",
            amountUsdc: amountMicros,
            active: true,
            status: "PENDING",
            externalReference: merchantAccountReference,
            idempotencyKey: (idempotencyKey && String(idempotencyKey).trim()) || null,
            receiptToken: generateReceiptId("subscription"),
            /* Abandoned checkouts used to sit at `incomplete` forever, so a merchant's list was
               mostly dead offers. Recorded explicitly rather than only derived so the window is
               visible in the API and in the database. */
            expiresAt: checkoutExpiry,
            sandboxMode: isTestMode,
            simulationOnly: false,
            settlementChainId: isTestMode ? ARC_TESTNET_CHAIN_ID : ProtocolConfig.CHAIN_ID,
            creationFingerprint: {
                merchantAddress,
                amountUsdc: amountMicros.toString(),
                beneficiaryAddress,
                linkKind: "MERCHANT",
                sandboxMode: isTestMode,
                simulationOnly: false,
                settlementChainId: isTestMode ? ARC_TESTNET_CHAIN_ID : ProtocolConfig.CHAIN_ID,
                maxUses: null,
                /* Kept in step with the column. The fingerprint is a snapshot of creation terms,
                   and /api/intent compares it field-by-field when an idempotencyKey is reused
                   across resources — a stale null there would let a subscription checkout be
                   handed back as a one-time intent instead of conflicting. */
                expiresAt: checkoutExpiry.toISOString(),
            },
            stateSnapshot: { subscription: subMeta },
        };
        /* Publication and checkout creation are atomic: a full public catalog cannot leave
           behind a valid but invisible API checkout. */
        const created = shouldPublishToDm
            ? await createCheckoutWithPublishedSitePlan(merchantAddress, linkData)
            : { link: await prisma.paymentLink.create({ data: linkData }), published: null };
        const link = created.link;

        await dispatchDurableSubscriptionWebhook(merchantAddress, "subscription.activated", subscriptionWebhookData({
            subscriptionId: link.id,
            status: "incomplete",
            amountUsdcMicros: amountMicros,
            subscriber: subscriberAddress,
            merchantAddress,
            externalReference: merchantAccountReference,
            sourceCheckoutId: link.id,
        }), `checkout-created:${link.id}`);

        /* New checkout + plan creation is atomic. The idempotency branch above still repairs
           legacy/unpublished checkouts by retrying their unique source identity. */
        const published = created.published;
        const canonicalPlanId = published?.plan.id || subMeta.planId || null;
        if (published && subscriberAddress) {
            try {
                await createSubscriptionOfferDm({
                    merchantAddress,
                    subscriberAddress,
                    checkoutSessionId: link.id,
                    planName: link.title,
                    amountUsdc: link.amountUsdc,
                    periodSeconds: subscriptionCheckoutPeriod(subMeta),
                });
            } catch (dmErr) {
                console.error("[subscriptions] DM offer creation side-effect failed:", dmErr);
            }
        }

        /* A just-created checkout cannot have a mirror row yet, so the view is serialized without
           one — same shape as the list and GET /{id}, `status: "incomplete"`, expiry included. */
        const createdView = serializeApiSubscription({ link, mirror: null });
        return NextResponse.json({
            success: true,
            subscription: {
                ...createdView,
                planId: canonicalPlanId,
            },
            sandbox: isSandbox,
        }, { status: 201 });
    } catch (error: any) {
        if (error instanceof SitePlanPublicationError || error?.name === "SitePlanPublicationError" || (error?.status && error?.code)) {
            return apiError({
                status: Number(error.status) || 400,
                code: String(error.code).toLowerCase(),
                message: error.message || "Site plan publication error",
            });
        }
        /* Never echo error.message — a raw ORM error in a 500 is how a schema gap goes public. */
        console.error("Subscriptions POST error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}

/* ---------------------------------- DELETE --------------------------------- */
/* Cancel a subscription checkout by id.
   - sub_<uuid>   -> a merchant may withdraw an offer that has not activated yet
   - sub_<number> -> active authorizations are customer-controlled and cannot be revoked here */
export async function DELETE(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        const merchantAddress = auth.merchantAddress;

        const { searchParams } = new URL(request.url);
        const idParam = (searchParams.get("id") || "").replace(/^sub_/, "");
        if (!idParam) {
            return NextResponse.json({ error: "Bad Request: missing subscription id" }, { status: 400 });
        }

        // An active on-chain authorization belongs to the subscriber. Merchants can set
        // cancelAtPeriodEnd = true on active subscriptions and notify the DM thread.
        if (/^\d+$/.test(idParam)) {
            /* Scoped to the active PSA. `subscription_id` is not unique — an immutable PSA
               restarts ids at 1 on every redeploy — so a bare (id, merchant) lookup can match a
               row stranded by an abandoned deployment and schedule a cancellation plus a
               merchant webhook for a subscription that no longer exists on chain. */
            const sub = await prisma.subscription.findFirst({
                where: { ...onActiveContract(), subscriptionId: BigInt(idParam), merchantAddress },
            });
            if (!sub) {
                return NextResponse.json({ error: "Subscription not found for this merchant" }, { status: 404 });
            }
            await prisma.subscription.update({
                where: {
                    contractAddress_subscriptionId: {
                        contractAddress: sub.contractAddress,
                        subscriptionId: sub.subscriptionId,
                    },
                },
                data: { cancelAtPeriodEnd: true, updatedAt: new Date() },
            });
            await createDmAndNotify({
                senderAddress: merchantAddress,
                receiverAddress: sub.subscriber || "",
                messageType: "SUBSCRIPTION_CANCELED",
                status: "APPROVED",
                title: "Subscription Canceled by Merchant",
                description: `Subscription sub_${idParam} was set to cancel at period end by the merchant. Access continues through your paid period.`,
            }).catch((err) => console.error("[v1/subscriptions] DM notification error:", err));

            await dispatchDurableSubscriptionWebhook(merchantAddress, "subscription.cancel_scheduled", subscriptionWebhookData({
                subscriptionId: idParam,
                status: "cancel_scheduled",
                amountUsdcMicros: sub.amountCapUsdc.toString(),
                subscriber: sub.subscriber || "",
                merchantAddress,
                reason: "Canceled by merchant via API",
            }), `merchant-cancel-scheduled:${idParam}`);

            return NextResponse.json({
                id: `sub_${idParam}`,
                object: "subscription",
                status: "cancel_scheduled",
                cancelAtPeriodEnd: true,
            }, { status: 200 });
        }

        // Checkout-session subscription (uuid): cancel it only if it hasn't activated on-chain.
        const link = await prisma.paymentLink.findUnique({ where: { id: idParam } });
        const linkMeta = readSubscriptionCheckoutMeta(link?.stateSnapshot);
        if (!link || link.merchantAddress.toLowerCase() !== merchantAddress || !linkMeta) {
            return NextResponse.json({ error: "Subscription not found for this merchant" }, { status: 404 });
        }
        if (link.status !== "PENDING") {
            const error = link.status === "PAID"
                ? "Conflict: active subscriptions must be canceled by on-chain subscription id"
                : "Conflict: this subscription checkout can no longer be canceled";
            return NextResponse.json({ error }, { status: 409 });
        }
        await prisma.$transaction([
            prisma.paymentLink.update({
                where: { id: idParam },
                data: { active: false, status: "CANCELED" },
            }),
            prisma.merchantPlan.updateMany({
                where: { sourceCheckoutId: idParam },
                data: { active: false },
            }),
        ]);
        await dispatchDurableSubscriptionWebhook(merchantAddress, "subscription.canceled", subscriptionWebhookData({
            subscriptionId: idParam,
            status: "canceled",
            amountUsdcMicros: link.amountUsdc,
            subscriber: linkMeta.subscriber,
            merchantAddress,
            beneficiary: linkMeta.beneficiary,
            externalReference: link.externalReference,
            sourceCheckoutId: link.id,
            reason: "Canceled before activation",
        }), `checkout-canceled:${idParam}`);
        return NextResponse.json({ id: `sub_${idParam}`, object: "subscription", status: "canceled" }, { status: 200 });
    } catch (error: any) {
        console.error("Subscriptions DELETE error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error. Quote the request_id when reporting this." });
    }
}
