/* Hard-cancel a subscription on-chain from a DM, then fire the merchant's (optional)
   exit survey. Server-signed from the embedded wallet; gas covered by SubScript. */
import { after, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { cancelFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { mirrorSubscriptionCanceled, mirrorSubscriptionCancelAtPeriodEnd } from "@/lib/subscriptions/mirror";
import { triggerExitSurvey } from "@/lib/payments/email";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { prisma } from "@/lib/prisma";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { sendWinbackOfferDm } from "@/lib/dms/lifecycle";
import { findWinbackPromotion } from "@/lib/subscriptions/promotions";
import { activeSubscriptionContract, subscriptionKey } from "@/lib/subscriptions/contractBinding";
import {
    sendSubscriptionCanceledEmail,
    sendSubscriptionCancellationNeedsSignatureEmail,
    sendSubscriptionCancelScheduledEmail,
} from "@/lib/email/templates/subscriptionLifecycle";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const subscriptionId = body.subscriptionId !== undefined ? String(body.subscriptionId) : "";
        if (!subscriptionId || !/^\d+$/.test(subscriptionId)) {
            return NextResponse.json({ error: "A valid subscriptionId is required" }, { status: 400 });
        }

        /* Only the subscriber may cancel. */
        const sub = await getSubscriptionOnChain(subscriptionId);
        if (!sub || sub.subscriber !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Subscription not found for this account" }, { status: 404 });
        }
        if (!sub.isActive) {
            return NextResponse.json({ error: "This subscription is already inactive" }, { status: 409 });
        }
        const mirrored = await prisma.subscription.findUnique({
            where: subscriptionKey(subscriptionId),
            select: {
                beneficiaryAddress: true,
                externalReference: true,
                sourceCheckoutId: true,
                planId: true,
                billingIntervalSeconds: true,
                plan: { select: { name: true } },
            },
        }).catch(() => null);

        /* Authorization and entitlement are separate concerns. The on-chain PSA authorization is
           revoked IMMEDIATELY — executePayment is permissionless, so anything left isActive stays
           chargeable no matter what the database says. The user's already-paid access survives
           off-chain: the mirror row stays ACTIVE with cancel_at_period_end until nextPayment, and
           the keeper finalizes the local status and final webhook when that paid period ends. */
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        if (sub.nextPayment > nowSec) {
            let revocationTxHash: string | null = null;
            let requiresWalletCancellation = false;
            try {
                await requireSponsoredGas({
                    wallet: wallet.toLowerCase(),
                    action: "subscription_cancel",
                    requestKey: `cancel:${subscriptionId}`,
                });
                revocationTxHash = await cancelFromEmbedded(wallet, subscriptionId);
            } catch (revokeError: any) {
                const message = String(revokeError?.message || revokeError || "");
                if (/no server-held key|connect a browser wallet|external_wallet/i.test(message)) {
                    /* External wallet: only the subscriber's own key can sign the revocation. */
                    requiresWalletCancellation = true;
                } else {
                    console.error(`[subscription/cancel] immediate revocation failed for sub ${subscriptionId}:`, message);
                }
            }

            const recorded = await mirrorSubscriptionCancelAtPeriodEnd({
                subscriptionId,
                merchantAddress: sub.merchant,
                subscriber: wallet.toLowerCase(),
                amountUsdc: sub.amount,
                periodSeconds: sub.period,
                nextPaymentSeconds: sub.nextPayment,
                revocationTxHash,
                /* While the authorization may still be live on-chain, the row must stay inside
                   the retry worker's queue — it is never terminal while chargeable. */
                revocationPending: !revocationTxHash,
            });
            /* This mirror row is the only record that stops future billing; if it didn't persist we
               must not tell the user the cancellation is booked. */
            if (!recorded) {
                return NextResponse.json({ error: "We couldn't record the cancellation. Please try again." }, { status: 500 });
            }

            const accessUntil = new Date(Number(sub.nextPayment) * 1000).toISOString();

            /* Fact sheet for the customer's email, built once and shared by the two outcomes
               below. Section 3.5 of docs/email-audit.md calls the cancellation confirmation
               "the email users screenshot as proof", and the customer was the one audience this
               route told nothing: the merchant got a DM, a webhook and an exit survey, while the
               person who cancelled got a JSON body they never see. */
            const cancellationEmailFacts = {
                subscriptionId,
                planName: mirrored?.plan?.name ?? null,
                amountUsdcMicros: sub.amount,
                periodSeconds: mirrored?.billingIntervalSeconds ?? sub.period,
                merchantAddress: sub.merchant,
                accessUntil,
                requestedAt: new Date(Number(nowSec) * 1000),
                contractAddress: activeSubscriptionContract(),
            };

            /* Distinct scheduled event now; the final subscription.canceled fires at entitlement
               expiry from the keeper.
             *
             * Dispatched BEFORE the external-wallet branch below, deliberately. The mirror row above
             * is what stops future billing, and it is already committed at this point — so returning
             * without telling the merchant left SubScript having stopped the subscription while the
             * merchant still believed it was live. The two wallet types told the merchant different
             * stories about the same action: an embedded-wallet subscriber generated this event, an
             * external-wallet one generated nothing until period end. */
            const revocationState = revocationTxHash
                ? "Cancellation requested; on-chain authorization revoked, access continues until period end"
                : requiresWalletCancellation
                    ? "Cancellation requested; the subscriber's own wallet must sign the on-chain revocation, so the authorization may still be chargeable"
                    : "Cancellation requested; on-chain revocation is retrying";
            try {
                await dispatchDurableSubscriptionWebhook(sub.merchant, "subscription.cancel_scheduled", {
                    ...subscriptionWebhookData({
                        subscriptionId,
                        status: "cancel_scheduled",
                        amountUsdcMicros: sub.amount,
                        subscriber: wallet.toLowerCase(),
                        merchantAddress: sub.merchant,
                        txHash: revocationTxHash ?? undefined,
                        beneficiary: mirrored?.beneficiaryAddress ?? null,
                        externalReference: mirrored?.externalReference ?? null,
                        sourceCheckoutId: mirrored?.sourceCheckoutId ?? null,
                        reason: revocationState,
                    }),
                    /* Whether the on-chain authorization is actually revoked yet. A merchant that
                       gates entitlement on this event should still honour access until period end
                       either way; this only says whether the chain agrees yet. */
                    revocation_pending: !revocationTxHash,
                    revocationPending: !revocationTxHash,
                    access_until: accessUntil,
                    accessUntil,
                }, `customer-cancel-scheduled:${subscriptionId}`);
            } catch (webhookError) {
                /* Revocation and the cancellation mirror are already durable. A delivery-outbox
                   outage must not turn the completed cancellation into an ambiguous HTTP 500. */
                console.error("[ALERT] cancellation webhook enqueue failed after state committed:", webhookError);
            }

            /* The thread was silent on the ordinary cancellation. Only the lapsed branch below wrote a
               DM, so a subscriber cancelling mid-period saw nothing in the conversation and neither
               did the merchant — the webhook was the only trace. This is also where the paid-through
               date gets stated somewhere durable rather than in a response body nobody keeps.

               Stays subscriber → merchant, and stays third-person. The subscriber's own confirmation
               is the email added below; this row exists so the MERCHANT learns the subscription
               stopped, and in the requiresWalletCancellation case that the authorization is still
               chargeable until the subscriber signs. Rewriting it in second person points both
               facts at the wrong audience. */
            await createDmAndNotify({
                senderAddress: wallet.toLowerCase(),
                receiverAddress: sub.merchant,
                messageType: "SUBSCRIPTION_CANCELED",
                status: "APPROVED",
                title: "Subscription Canceled",
                description: requiresWalletCancellation
                    ? `Subscription sub_${subscriptionId} was canceled by the subscriber. Access continues through the paid period, until ${accessUntil.slice(0, 10)}. The subscriber still needs to sign the on-chain revocation from their own wallet.`
                    : `Subscription sub_${subscriptionId} was canceled by the subscriber. Access continues through the paid period, until ${accessUntil.slice(0, 10)}. No further payments will be taken.`,
                dedupeKey: `subscription-cancel-scheduled:${subscriptionId}`,
            }).catch((err) => console.error("[subscription/cancel] DM notification failed:", err));

            /* And the subscriber's own half of the same event, merchant → subscriber.
             *
             * The row above is deliberately third-person and addressed to the merchant, which is
             * correct for its audience but is not something to show the person who cancelled: their
             * thread with a merchant is a one-way notification feed drawn in the merchant's voice, so
             * a merchant-facing row rendered there reads as the merchant narrating their actions back
             * at them. Two rows rather than a rewrite, the same way pausing a metered service writes
             * SERVICE_CANCELED to the merchant and SERVICE_PAUSED to the subscriber. The inbox hides
             * the merchant-facing one from the subscriber (see MERCHANT_OPS_DM_TYPES) so they see
             * exactly one notice.
             *
             * The email added below is the durable receipt; this is the in-app trace. */
            await createDmAndNotify({
                senderAddress: sub.merchant,
                receiverAddress: wallet.toLowerCase(),
                messageType: "SUBSCRIPTION_CANCELED",
                status: "APPROVED",
                title: "Subscription canceled",
                description: requiresWalletCancellation
                    ? `Your subscription sub_${subscriptionId} is canceled. You keep access through the period you've already paid for, until ${accessUntil.slice(0, 10)}. One step left — sign the on-chain revocation from your wallet.`
                    : `Your subscription sub_${subscriptionId} is canceled. You keep access through the period you've already paid for, until ${accessUntil.slice(0, 10)}. We won't take any more payments.`,
                dedupeKey: `subscription-cancel-scheduled-subscriber:${subscriptionId}`,
            }).catch((err) => console.error("[subscription/cancel] subscriber DM notification failed:", err));

            if (requiresWalletCancellation) {
                /* Do NOT claim the cancellation is safely scheduled: the connected wallet must
                   sign cancelSubscription itself. The revocation_pending row keeps the retry
                   worker watching until the chain reports inactive. */

                /* The email on this path is not a confirmation, and it must never read like one.
                   The authorization is still chargeable until the subscriber's own key signs the
                   revocation, so this one states the unfinished step instead. It's also the only
                   notice they get: the 409 body is rendered as a red error string in the
                   dashboard, and nothing in the UI walks them through signing it. */
                after(async () => {
                    await sendSubscriptionCancellationNeedsSignatureEmail({
                        subscriberAddress: wallet.toLowerCase(),
                        facts: cancellationEmailFacts,
                    });
                });

                return NextResponse.json({
                    success: false,
                    requiresWalletCancellation: true,
                    subscriptionId,
                    error: "Your connected wallet must sign the on-chain cancellation. Until that transaction confirms, this subscription remains chargeable on-chain.",
                    accessUntil,
                }, { status: 409 });
            }

            await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
                console.error("[subscription/cancel] survey trigger failed:", err)
            );

            /* Retention offer, if the merchant has published one this subscriber can take.
             *
             * sendWinbackOfferDm shipped complete with zero callers, so a merchant could configure a
             * returning-customer offer and no departing subscriber would ever see it. Keyed on the
             * cancellation rather than a cycle, so one offer per cancellation and not one per pass.
             * Presentation only — the redemption is claimed if and when they actually resubscribe. */
            if (mirrored?.planId) {
                try {
                    const winback = await findWinbackPromotion({
                        planId: mirrored.planId,
                        merchantAddress: sub.merchant,
                        subscriber: wallet.toLowerCase(),
                    });
                    if (winback) {
                        await sendWinbackOfferDm({
                            merchantAddress: sub.merchant,
                            subscriberAddress: wallet.toLowerCase(),
                            subscriptionId,
                            planName: mirrored.plan?.name ?? null,
                            promotionName: winback.name,
                            offerAmountUsdcMicros: winback.introductoryAmountUsdc,
                            regularAmountUsdcMicros: winback.regularAmountUsdc,
                            offerCycles: winback.introductoryCycles,
                            periodSeconds: mirrored.billingIntervalSeconds ?? sub.period,
                            accessUntil: new Date(Number(sub.nextPayment) * 1000),
                            expiresAt: winback.expiresAt,
                        });
                    }
                } catch (winbackError) {
                    /* A retention offer is never worth failing a cancellation over. */
                    console.error("[subscription/cancel] win-back offer failed:", winbackError);
                }
            }

            /* The customer's receipt. Sent after the response because the cancellation is already
               durable at this point and a mail outage must never turn it into an HTTP 500. */
            after(async () => {
                await sendSubscriptionCancelScheduledEmail({
                    subscriberAddress: wallet.toLowerCase(),
                    facts: cancellationEmailFacts,
                    revocationTxHash,
                });
            });

            return NextResponse.json({
                success: true,
                cancelAtPeriodEnd: true,
                revoked: Boolean(revocationTxHash),
                revocationPending: !revocationTxHash,
                txHash: revocationTxHash,
                accessUntil,
            }, { status: 200 });
        }

        /* Period already lapsed — no remaining days to preserve, so cancel on-chain immediately. */
        await requireSponsoredGas({
            wallet: wallet.toLowerCase(),
            action: "subscription_cancel",
            requestKey: `cancel:${subscriptionId}`,
        });

        const txHash = await cancelFromEmbedded(wallet, subscriptionId);

        /* Reflect the cancellation in the dashboard mirror (best-effort). */
        await mirrorSubscriptionCanceled(subscriptionId);

        if (sub.merchant === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
            await prisma.merchant.update({
                where: { walletAddress: wallet.toLowerCase() },
                data: { tier: "FREE" },
            }).catch((err: unknown) => console.error("[subscription/cancel] tier downgrade failed:", err));
        }

        try {
            await dispatchDurableSubscriptionWebhook(sub.merchant, "subscription.canceled", subscriptionWebhookData({
                subscriptionId,
                status: "canceled",
                amountUsdcMicros: sub.amount,
                subscriber: wallet.toLowerCase(),
                merchantAddress: sub.merchant,
                txHash,
                beneficiary: mirrored?.beneficiaryAddress ?? null,
                externalReference: mirrored?.externalReference ?? null,
                sourceCheckoutId: mirrored?.sourceCheckoutId ?? null,
                reason: "Canceled by subscriber",
            }), `customer-canceled:${subscriptionId}:${txHash.toLowerCase()}`);
        } catch (webhookError) {
            console.error("[ALERT] cancellation webhook enqueue failed after state committed:", webhookError);
        }

        /* Subscriber → merchant, same audience as the mid-period branch above. The dedupe key it
           was missing is scoped to this branch, so a mid-period cancel followed later by a lapsed
           one still writes both rows. */
        await createDmAndNotify({
            senderAddress: wallet.toLowerCase(),
            receiverAddress: sub.merchant,
            messageType: "SUBSCRIPTION_CANCELED",
            status: "APPROVED",
            title: "Subscription Canceled",
            description: `Subscription sub_${subscriptionId} was canceled by the subscriber.`,
            dedupeKey: `subscription-cancel-immediate:${subscriptionId}`,
        }).catch((err) => console.error("[subscription/cancel] DM notification failed:", err));

        /* Subscriber's half of the same event, as in the mid-period branch above. No paid-through
           date here: the period had already lapsed, so access is over now and saying otherwise
           would promise time that does not exist. */
        await createDmAndNotify({
            senderAddress: sub.merchant,
            receiverAddress: wallet.toLowerCase(),
            messageType: "SUBSCRIPTION_CANCELED",
            status: "APPROVED",
            title: "Subscription canceled",
            description: `Your subscription sub_${subscriptionId} is canceled. Access has ended and we won't take any more payments.`,
            dedupeKey: `subscription-cancel-immediate-subscriber:${subscriptionId}`,
        }).catch((err) => console.error("[subscription/cancel] subscriber DM notification failed:", err));

        /* Fire the merchant's exit survey (no-op if the merchant disabled it). */
        await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
            console.error("[subscription/cancel] survey trigger failed:", err)
        );

        /* Same receipt as the mid-period branch, minus the paid-through date: this period had
           already lapsed, so access is over now and the email says so rather than implying
           there are days left to use. */
        after(async () => {
            await sendSubscriptionCanceledEmail({
                subscriberAddress: wallet.toLowerCase(),
                facts: {
                    subscriptionId,
                    planName: mirrored?.plan?.name ?? null,
                    amountUsdcMicros: sub.amount,
                    periodSeconds: mirrored?.billingIntervalSeconds ?? sub.period,
                    merchantAddress: sub.merchant,
                    requestedAt: new Date(),
                    contractAddress: activeSubscriptionContract(),
                },
                cancellationTxHash: txHash,
            });
        });

        return NextResponse.json({ success: true, txHash, cancelAtPeriodEnd: false }, { status: 200 });
    } catch (error: any) {
        console.error("Cancel subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to cancel subscription" }, { status: 500 });
    }
}
