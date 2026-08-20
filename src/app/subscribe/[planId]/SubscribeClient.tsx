"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, RefreshCw, ExternalLink,
} from "@/components/icons";
import SubscribeSkeleton from "./SubscribeSkeleton";

type PlanPromotionData = {
    id: string;
    name: string;
    discountType: string;
    discountBps: number | null;
    introductoryAmountUsdc: string;
    introductoryCycles: number;
    expiresAt: string | null;
    newCustomersOnly: boolean;
};

type PlanData = {
    id: string;
    name: string;
    description?: string | null;
    detailsUrl?: string | null;
    amountUsdc: string;
    periodSeconds: string;
    minCommitmentSeconds?: string;
    merchantAddress: string;
    checkoutSessionId?: string;
    successUrl?: string;
    cancelUrl?: string;
    promotion?: PlanPromotionData | null;
    merchant?: {
        address: string;
        name: string;
        alias: string | null;
        profilePic?: string | null;
        verified?: boolean;
        isEnterprise?: boolean;
    };
};

type SessionInfo = { loggedIn: boolean; wallet?: string; email?: string | null; role?: string | null; isEmbedded?: boolean; provider?: string | null };

function formatPeriod(seconds: string) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "cycle";
    const days = Math.round(value / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
}

function formatAmount(micros: string) {
    return (Number(micros) / 1_000_000).toFixed(2);
}

function getHostname(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

type SubscriptionResult = { txHash?: string; subscriptionId?: string; planName?: string };

function buildMerchantSuccessUrl(successUrl: string, planId: string, result: SubscriptionResult) {
    try {
        const url = new URL(successUrl);
        url.searchParams.set("subscript_status", "success");
        url.searchParams.set("subscript_verification_status", "settled");
        url.searchParams.set("subscript_plan_id", planId);
        if (result.subscriptionId) {
            url.searchParams.set("subscript_subscription_id", result.subscriptionId);
        }
        if (result.txHash) url.searchParams.set("subscript_tx_hash", result.txHash);
        return url.toString();
    } catch {
        return null;
    }
}

function friendlyError(raw: string): string {
    const map: [RegExp, string][] = [
        [/USDC approval.*reverted/i, "Your wallet denied the spending approval. Please try again."],
        [/CCTP.*failed/i, "The cross-chain transfer could not be completed. Check your balance and try again."],
        [/payment transaction failed/i, "The payment could not be completed. Check your balance and try again."],
        [/reverted or failed/i, "The payment was rejected by the network. No funds were taken."],
        [/stream disconnected/i, "Lost connection while confirming. Your payment may still be processing — check your wallet."],
        [/payment verification failed/i, "We couldn't confirm your payment yet. If funds left your wallet, it may still be processing."],
        [/failed to initiate verification/i, "We couldn't start payment confirmation. Please try again."],
        [/user rejected/i, "You declined the transaction in your wallet."],
        [/insufficient funds/i, "Your wallet doesn't have enough funds for this transaction."],
    ];
    for (const [pattern, friendly] of map) {
        if (pattern.test(raw)) return friendly;
    }
    return raw;
}

/* Responses that mean "you already have this", not "something broke". The subscribe route returns
   these as 409s whose body describes a live subscription with time remaining — rendering them under
   a red "Subscription Failed" heading told the customer the opposite of what the text said. */
const ALREADY_SUBSCRIBED_CODES = new Set([
    "RESUBSCRIPTION_TOO_EARLY",
    "ALREADY_SUBSCRIBED",
    "ACTIVE_MERCHANT_SUBSCRIPTION",
]);

type SubscribeFailure = { message: string; code: string | null };

export default function SubscribeClient({
    planId,
    initialPlanData,
}: {
    planId: string;
    initialPlanData: PlanData | null;
}) {
    const router = useRouter();

    const [plan, setPlan] = useState<PlanData | null>(initialPlanData);
    const [isLoading, setIsLoading] = useState(!initialPlanData);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [session, setSession] = useState<SessionInfo | null>(null);
    const [sessionLoaded, setSessionLoaded] = useState(false);

    const [isSubscribing, setIsSubscribing] = useState(false);
    const [subscribeError, setSubscribeError] = useState<SubscribeFailure | null>(null);
    const [result, setResult] = useState<SubscriptionResult | null>(null);

    /* Interstitial before following the merchant-supplied "view more" link off-platform. */
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [showSubscribeReview, setShowSubscribeReview] = useState(false);
    const [emailInput, setEmailInput] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [emailStep, setEmailStep] = useState<"email" | "code">("email");
    const [emailBusy, setEmailBusy] = useState(false);
    const [emailError, setEmailError] = useState<string | null>(null);

    const handleConfirmLeave = () => {
        if (plan?.detailsUrl) {
            window.open(plan.detailsUrl, "_blank", "noopener,noreferrer");
        }
        setShowLeaveModal(false);
    };

    /* Fetch fresh plan + merchant info (verified badge, profile pic) on mount. */
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`/api/plans/${planId}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) throw new Error(data.error || "This subscription plan is unavailable.");
                if (!cancelled) {
                    setPlan({
                        id: data.plan.id,
                        name: data.plan.name,
                        description: data.plan.description ?? null,
                        detailsUrl: data.plan.detailsUrl ?? null,
                        amountUsdc: data.plan.amountUsdc,
                        periodSeconds: data.plan.periodSeconds,
                        minCommitmentSeconds: data.plan.minCommitmentSeconds ?? "0",
                        merchantAddress: data.plan.merchantAddress,
                        checkoutSessionId: data.plan.checkoutSessionId,
                        successUrl: data.plan.successUrl,
                        cancelUrl: data.plan.cancelUrl,
                        promotion: data.plan.promotion ?? null,
                        merchant: data.merchant,
                    });
                    setLoadError(null);
                }
            } catch (err: any) {
                if (!cancelled && !initialPlanData) setLoadError(err.message || "Failed to load plan.");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [planId, initialPlanData]);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/auth/session")
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setSession(data); })
            .catch(() => { if (!cancelled) setSession({ loggedIn: false }); })
            .finally(() => { if (!cancelled) setSessionLoaded(true); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!result || !plan?.successUrl) return;
        const successUrl = buildMerchantSuccessUrl(plan.successUrl, plan.id, result);
        if (!successUrl) return;
        const redirectTimer = window.setTimeout(() => {
            window.location.assign(successUrl);
        }, 3500);
        return () => window.clearTimeout(redirectTimer);
    }, [result, plan?.id, plan?.successUrl]);

    const handleSignIn = () => {
        const next = `/subscribe/${planId}`;
        router.push(`/signin?next=${encodeURIComponent(next)}`);
    };

    const refreshSession = async () => {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json().catch(() => ({ loggedIn: false }));
        setSession(data);
        return data;
    };

    const sendEmailCode = async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
            setEmailError("Enter a valid email address.");
            return;
        }
        setEmailBusy(true);
        setEmailError(null);
        try {
            const response = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: emailInput.trim(), purpose: "bind_wallet_email" }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || "Could not send the verification code.");
            setEmailStep("code");
        } catch (error: any) {
            setEmailError(error.message || "Could not send the verification code.");
        } finally {
            setEmailBusy(false);
        }
    };

    const verifyEmailCode = async () => {
        if (!/^\d{6}$/.test(emailCode)) {
            setEmailError("Enter the 6-digit code we emailed you.");
            return;
        }
        setEmailBusy(true);
        setEmailError(null);
        try {
            const response = await fetch("/api/user/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: emailInput.trim(), code: emailCode }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || "Email verification failed.");
            await refreshSession();
        } catch (error: any) {
            setEmailError(error.message || "Email verification failed.");
        } finally {
            setEmailBusy(false);
        }
    };

    /* Stable per subscribe attempt: reused on retry so the server's Circle idempotency key
       dedupes the first charge instead of creating a second paid subscription. */
    const subscribeRequestKey = useRef<string | null>(null);
    const subscribeInFlight = useRef(false);

    const handleSubscribe = async () => {
        if (!plan || isSubscribing || subscribeInFlight.current) return;
        subscribeInFlight.current = true;
        setIsSubscribing(true);
        setSubscribeError(null);
        try {
            subscribeRequestKey.current ||= crypto.randomUUID();
            const requestStorageKey = `subscript_subscription_attempt:${session?.wallet || "anonymous"}:${plan.checkoutSessionId || plan.id}`;
            subscribeRequestKey.current = localStorage.getItem(requestStorageKey) || subscribeRequestKey.current;
            localStorage.setItem(requestStorageKey, subscribeRequestKey.current);
            const res = await fetch("/api/user/subscription/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-request-id": subscribeRequestKey.current },
                body: JSON.stringify(plan.checkoutSessionId
                    ? { checkoutSessionId: plan.checkoutSessionId }
                    : { planId: plan.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                /* Carry the response code, not just the message. It is what separates "you already
                   have this plan" from a real failure, and the two need different treatments. */
                const failure = new Error(data.error || "Failed to subscribe.") as Error & { code?: string };
                if (typeof data.code === "string") failure.code = data.code;
                throw failure;
            }
            subscribeRequestKey.current = null;
            localStorage.removeItem(requestStorageKey);
            setResult({ txHash: data.txHash, subscriptionId: data.subscriptionId, planName: data.planName });
        } catch (err: any) {
            setSubscribeError({
                message: friendlyError(err?.message || "Failed to subscribe."),
                code: typeof err?.code === "string" ? err.code : null,
            });
        } finally {
            subscribeInFlight.current = false;
            setIsSubscribing(false);
        }
    };

    const merchant = plan?.merchant;
    const isEnterpriseViewer = session?.role === "ENTERPRISE";
    const isExternalWalletViewer = Boolean(session?.loggedIn && !session?.isEmbedded);

    /* Introductory offer disclosure. The customer authorizes BOTH prices: the intro
       charge today (0 for a free trial) and the regular recurring price after
       `introductoryCycles` cycles — the switch is enforced on-chain. */
    const promo = plan?.promotion ?? null;
    const isFreeTrial = promo ? Number(promo.introductoryAmountUsdc) === 0 : false;
    const firstRegularDate = plan && promo
        ? new Date(Date.now() + promo.introductoryCycles * Number(plan.periodSeconds) * 1000)
        : null;

    /* Honour the OS setting rather than animating regardless: framer-motion returns true here when
       prefers-reduced-motion is set, and every transition below collapses to 0s. */
    const reduceMotion = useReducedMotion();
    const cardMotion = reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 12 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
        };
    const panelMotion = reduceMotion
        ? {}
        : {
            initial: { opacity: 0, height: 0 },
            animate: { opacity: 1, height: "auto" as const },
            exit: { opacity: 0, height: 0 },
            transition: { duration: 0.18, ease: "easeOut" as const },
        };

    return (
        /* Light ivory shell, matching the one-time checkout at /pay/[id]. Both are public hosted
           checkouts and now read as one product; the dark glassmorphism belongs to the dashboards.
           The dark-theme override layer in globals.css is scoped to .merchant-dashboard-root /
           .user-dashboard-redesign, so nothing here gets repainted. */
        <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">subscribe</span>
                    </h1>
                    <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Recurring USDC subscription</p>
                </div>

                {isLoading ? (
                    <SubscribeSkeleton />
                ) : loadError || !plan ? (
                    <div className="rounded-3xl border border-red-200 bg-red-50 p-6 sm:p-8 shadow-sm flex flex-col items-center justify-center text-center gap-6 py-12" role="alert">
                        <div className="p-4 rounded-3xl bg-red-100 border border-red-200 text-red-700">
                            <AlertTriangle className="w-10 h-10" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-base font-bold text-red-900">Plan unavailable</h2>
                            <p className="text-xs text-red-900/80 leading-relaxed max-w-xs">
                                {loadError || "This subscription plan could not be found or is no longer active."}
                            </p>
                        </div>
                    </div>
                ) : (
                    <motion.div {...cardMotion} className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">

                        {/* Merchant identity */}
                        <div className="flex items-center gap-3">
                            {merchant?.profilePic ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={merchant.profilePic} alt="" className="h-10 w-10 rounded-full object-cover border border-black/10" />
                            ) : (
                                <div className="h-10 w-10 rounded-full bg-[#2775CA]/10 border border-[#2775CA]/20 flex items-center justify-center text-[#1f62ab] font-black uppercase">
                                    {(merchant?.name || "M").slice(0, 1)}
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold text-black/60 uppercase tracking-widest">Subscribing to</p>
                                <p className="truncate font-mono text-sm font-bold text-[#111827]">{merchant?.name || "Merchant"}</p>
                            </div>
                            {merchant?.verified && (
                                <div className="ml-auto flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                                    <Shield className="w-3 h-3 text-emerald-700" />
                                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Verified</span>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <span className="text-[10px] font-bold text-black/60 uppercase tracking-widest">Plan</span>
                            <h2 className="text-2xl font-extrabold text-[#111827] tracking-tight">{plan.name}</h2>
                        </div>

                        {(plan.description || plan.detailsUrl) && (
                            <div className="space-y-2">
                                {plan.description && (
                                    <p className="text-xs text-black/70 leading-relaxed whitespace-pre-line">
                                        {plan.description}
                                    </p>
                                )}
                                {plan.detailsUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setShowLeaveModal(true)}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1f62ab] transition hover:text-[#2775CA]"
                                    >
                                        <ExternalLink className="w-3 h-3" /> View full details
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="rounded-2xl border border-black/10 bg-[#f8fafc] p-5 flex justify-between items-center">
                            <span className="text-[10px] text-black/60 uppercase font-bold tracking-wider flex items-center gap-1.5">
                                <RefreshCw className="w-3 h-3" /> {promo ? "Due today" : "Recurring"}
                            </span>
                            <div className="text-right">
                                {promo && (
                                    <p className="text-[10px] font-bold text-black/60 line-through">
                                        {formatAmount(plan.amountUsdc)} USDC
                                    </p>
                                )}
                                <p className="text-2xl font-extrabold text-[#2775CA] tracking-tight">
                                    {promo ? formatAmount(promo.introductoryAmountUsdc) : formatAmount(plan.amountUsdc)}
                                </p>
                                <p className="text-[10px] text-black/60 uppercase font-bold tracking-widest font-mono">
                                    {promo
                                        ? `USDC today · then ${formatAmount(plan.amountUsdc)} / ${formatPeriod(plan.periodSeconds)}`
                                        : `USDC / ${formatPeriod(plan.periodSeconds)}`}
                                </p>
                            </div>
                        </div>

                        {promo && (
                            <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] px-4 py-3 space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#1f62ab]">{promo.name}</p>
                                <p className="text-xs leading-relaxed text-black/70">
                                    {isFreeTrial
                                        ? <>Your first {promo.introductoryCycles > 1 ? `${promo.introductoryCycles} billing cycles are` : `${formatPeriod(plan.periodSeconds)} is`} <span className="font-bold text-[#111827]">free</span>.</>
                                        : <>You pay <span className="font-bold text-[#111827]">{formatAmount(promo.introductoryAmountUsdc)} USDC</span> per {formatPeriod(plan.periodSeconds)} for {promo.introductoryCycles > 1 ? `your first ${promo.introductoryCycles} cycles` : `your first ${formatPeriod(plan.periodSeconds)}`}.</>}{" "}
                                    From <span className="font-bold text-[#111827]">{firstRegularDate?.toLocaleDateString()}</span> the regular price of{" "}
                                    <span className="font-bold text-[#111827]">{formatAmount(plan.amountUsdc)} USDC / {formatPeriod(plan.periodSeconds)}</span> applies.
                                    Cancel before then to avoid it.
                                </p>
                            </div>
                        )}

                        <p className="text-xs text-black/70 leading-relaxed">
                            You&apos;ll be charged <span className="text-[#111827] font-bold">{formatAmount(promo ? promo.introductoryAmountUsdc : plan.amountUsdc)} USDC</span> now and then
                            automatically every <span className="text-[#111827] font-bold">{formatPeriod(plan.periodSeconds)}</span>
                            {promo ? <> (at <span className="text-[#111827] font-bold">{formatAmount(plan.amountUsdc)} USDC</span> once the introductory period ends)</> : null}. You can cancel
                            anytime from your SubScript dashboard.
                        </p>
                        {Number(plan.minCommitmentSeconds || 0) > 0 && (
                            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
                                This plan has a minimum commitment of{" "}
                                <span className="font-bold">{Math.max(1, Math.round(Number(plan.minCommitmentSeconds) / 86_400))} day{Math.round(Number(plan.minCommitmentSeconds) / 86_400) === 1 ? "" : "s"}</span>.
                                Cancelling before it ends takes effect at the end of your current paid period — you are never billed beyond
                                the period you already approved.
                            </p>
                        )}

                        {result ? (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                                <CheckCircle className="w-8 h-8 text-emerald-700" />
                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-emerald-900">Subscribed to {result.planName || plan.name}</p>
                                    <p className="text-xs text-emerald-900/80 leading-relaxed">
                                        {promo && isFreeTrial
                                            ? "Your free period has started — nothing was charged today."
                                            : promo
                                                ? `Your introductory payment of ${formatAmount(promo.introductoryAmountUsdc)} USDC has been taken.`
                                                : "Your payment was processed successfully."}
                                    </p>
                                </div>
                                <p className="text-xs text-black/70 leading-relaxed bg-white border border-black/10 rounded-xl p-3">
                                    Manage, upgrade, or pause your subscription anytime from your <span className="font-bold text-[#111827]">SubScript user dashboard</span> (merchant DM).
                                </p>
                                <div className="w-full space-y-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/user?tab=inbox&peer=${encodeURIComponent(plan.merchantAddress)}`)}
                                        className="w-full py-3.5 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                    >
                                        Go to SubScript dashboard <ArrowRight className="w-4 h-4" />
                                    </button>
                                    {plan.successUrl && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const successUrl = buildMerchantSuccessUrl(plan.successUrl!, plan.id, result);
                                                if (successUrl) window.location.assign(successUrl);
                                            }}
                                            className="w-full py-2.5 text-xs font-bold text-black/60 hover:text-[#111827] transition"
                                        >
                                            Return to {getHostname(plan.successUrl)}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : !sessionLoaded ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-[#2775CA]" />
                            </div>
                        ) : isEnterpriseViewer ? (
                            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3" role="alert">
                                <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                                <p className="text-xs text-red-900/90 leading-relaxed">
                                    You&apos;re signed in as a <span className="font-bold text-red-900">merchant</span> account. Only standard user
                                    accounts can subscribe to a plan. Sign in with a user account to continue.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <AnimatePresence initial={false}>
                                    {subscribeError && (
                                        <motion.div key={subscribeError.code || "failure"} {...panelMotion} className="overflow-hidden">
                                            {subscribeError.code && ALREADY_SUBSCRIBED_CODES.has(subscribeError.code) ? (
                                                <div className="space-y-3 rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 text-left">
                                                    <div className="flex items-center gap-2">
                                                        <CheckCircle className="w-4 h-4 text-[#1f62ab] shrink-0" />
                                                        <p className="text-xs font-bold text-[#1f62ab]">You&apos;re already subscribed</p>
                                                    </div>
                                                    <p className="text-xs leading-relaxed text-black/70">{subscribeError.message}</p>
                                                    <button
                                                        type="button"
                                                        onClick={() => router.push(`/user?tab=inbox&peer=${encodeURIComponent(plan.merchantAddress)}`)}
                                                        className="w-full rounded-xl bg-white hover:bg-black/5 border border-black/15 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[#111827] flex items-center justify-center gap-2 transition-all"
                                                    >
                                                        Manage this subscription <ArrowRight className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-left" role="alert">
                                                    <span className="text-red-900 text-xs font-bold block">Subscription failed</span>
                                                    <p className="text-red-900/80 text-xs font-mono mt-1 leading-normal break-words">{subscribeError.message}</p>
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {session?.loggedIn && !session.email ? (
                                    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                                        <p className="text-xs font-bold text-amber-900">Verified email required</p>
                                        <p className="text-xs leading-relaxed text-amber-900/80">Confirm an email with the emailed code before authorizing a recurring payment.</p>
                                        {emailStep === "email" ? <>
                                            <label htmlFor="subscribe-email" className="sr-only">Email address</label>
                                            <input id="subscribe-email" type="email" value={emailInput} onChange={(event) => { setEmailInput(event.target.value); setEmailError(null); }} placeholder="you@example.com" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-xs text-[#111827] placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                                            <button type="button" onClick={sendEmailCode} disabled={emailBusy} className="w-full rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[#FFFFF0] transition-all disabled:opacity-50">{emailBusy ? "Sending…" : "Send email code"}</button>
                                        </> : <>
                                            <label htmlFor="subscribe-otp" className="sr-only">Six-digit verification code</label>
                                            <input id="subscribe-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(event) => { setEmailCode(event.target.value.replace(/\D/g, "")); setEmailError(null); }} placeholder="6-digit code" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-center text-xs tracking-[0.3em] text-[#111827] placeholder:tracking-normal placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                                            <button type="button" onClick={verifyEmailCode} disabled={emailBusy} className="w-full rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[#FFFFF0] transition-all disabled:opacity-50">{emailBusy ? "Verifying…" : "Verify email"}</button>
                                        </>}
                                        {emailError && <p className="text-xs text-red-900 font-medium" role="alert">{emailError}</p>}
                                    </div>
                                ) : isExternalWalletViewer ? (
                                    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                                        <p className="text-xs font-bold text-amber-900">SubScript wallet required</p>
                                        <p className="text-xs leading-relaxed text-amber-900/80">Recurring billing is gas-sponsored from a SubScript email or Google wallet. Browser wallets can pay one-time checkouts, but cannot safely authorize this recurring plan yet.</p>
                                        <button type="button" onClick={handleSignIn} className="w-full rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[#FFFFF0] transition-all">Sign in with email or Google</button>
                                    </div>
                                ) : session?.loggedIn ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowSubscribeReview(true)}
                                        disabled={isSubscribing}
                                        className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                    >
                                        {isSubscribing ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up subscription…</>
                                            : <>Review subscription <ArrowRight className="w-4 h-4" /></>}
                                    </button>
                                ) : (
                                    <>
                                        <p className="text-xs text-black/70 text-center leading-relaxed">
                                            Sign in or create a free SubScript account to subscribe. Gas is on us.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleSignIn}
                                            className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                        >
                                            Sign in to subscribe <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="pt-2 flex items-center justify-center gap-1.5 text-[10px] text-black/60 font-sans">
                            <Lock className="w-3 h-3" /> Secured by the SubScript subscription protocol
                        </div>
                    </motion.div>
                )}
            </div>

            {showSubscribeReview && plan && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" aria-labelledby="subscription-review-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-black/15 bg-white p-6 shadow-xl">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1f62ab]">Recurring authorization</p>
                            <h3 id="subscription-review-title" className="mt-1 text-xl font-black text-[#111827]">Review subscription</h3>
                        </div>
                        {plan.cancelUrl && !result && (
                            <a href={plan.cancelUrl} className="block text-center text-xs text-black/60 underline hover:text-[#111827]">Cancel and return to {getHostname(plan.cancelUrl)}</a>
                        )}
                        <div className="space-y-3 rounded-2xl border border-black/10 bg-[#f8fafc] p-4 text-xs">
                            <div className="flex justify-between gap-4"><span className="text-black/60">Merchant</span><span className="text-right font-bold text-[#111827]">{merchant?.name || "Merchant"}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-black/60">Charge today</span><span className="font-bold text-[#111827]">{formatAmount(promo ? promo.introductoryAmountUsdc : plan.amountUsdc)} USDC</span></div>
                            {promo && (
                                <div className="flex justify-between gap-4"><span className="text-black/60">Regular price</span><span className="font-bold text-[#111827]">{formatAmount(plan.amountUsdc)} USDC / {formatPeriod(plan.periodSeconds)}</span></div>
                            )}
                            <div className="flex justify-between gap-4"><span className="text-black/60">Renews</span><span className="font-bold text-[#111827]">Every {formatPeriod(plan.periodSeconds)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-black/60">Estimated next charge</span><span className="text-right font-bold text-[#111827]">{new Date(Date.now() + Number(plan.periodSeconds) * 1000).toLocaleDateString()}</span></div>
                            {promo && firstRegularDate && (
                                <div className="flex justify-between gap-4"><span className="text-black/60">First full-price renewal</span><span className="text-right font-bold text-[#111827]">{firstRegularDate.toLocaleDateString()}</span></div>
                            )}
                        </div>
                        {promo && (
                            <p className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-3 text-xs leading-relaxed text-black/70">
                                You are authorizing both prices now: {isFreeTrial ? "0 USDC" : `${formatAmount(promo.introductoryAmountUsdc)} USDC`} per {formatPeriod(plan.periodSeconds)} during
                                the introductory period, then {formatAmount(plan.amountUsdc)} USDC per {formatPeriod(plan.periodSeconds)}. The price can never
                                exceed what you approve here. Cancel before {firstRegularDate?.toLocaleDateString()} to avoid the regular price.
                            </p>
                        )}
                        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">Confirming authorizes recurring USDC charges under these terms. You can manage or cancel the subscription from your dashboard; any minimum commitment shown above still applies.</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => setShowSubscribeReview(false)} disabled={isSubscribing} className="rounded-2xl border border-black/15 bg-white hover:bg-black/5 px-4 py-3 text-xs font-bold text-[#111827] transition-all disabled:opacity-50">Back</button>
                            <button type="button" onClick={() => { setShowSubscribeReview(false); void handleSubscribe(); }} disabled={isSubscribing} className="rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] px-4 py-3 text-xs font-bold text-[#FFFFF0] transition-all disabled:opacity-50">Confirm subscription</button>
                        </div>
                    </div>
                </div>
            )}

            {showLeaveModal && plan?.detailsUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setShowLeaveModal(false)}
                >
                    <div
                        className="rounded-3xl border border-black/15 bg-white p-6 shadow-xl w-full max-w-sm space-y-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 shrink-0">
                                <ShieldAlert className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-bold text-[#111827]">You&apos;re leaving SubScript</h3>
                        </div>

                        <div className="space-y-3 text-xs leading-relaxed text-black/70">
                            <p>
                                This link opens an external site the merchant controls
                                (<span className="font-mono text-[#111827] break-all">{getHostname(plan.detailsUrl)}</span>).
                                SubScript can&apos;t vouch for its content and isn&apos;t responsible for anything that happens there.
                            </p>
                            <p className="font-bold text-[#111827]">
                                Never enter payment details on that site. All payments for this subscription happen only here, on SubScript.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={handleConfirmLeave}
                                className="w-full py-3 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                            >
                                OK, I understand <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowLeaveModal(false)}
                                className="w-full py-2.5 text-xs font-bold text-black/60 hover:text-[#111827] transition"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
