"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, RefreshCw, ExternalLink,
} from "@/components/icons";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

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
    const [subscribeError, setSubscribeError] = useState<string | null>(null);
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
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to subscribe.");
            subscribeRequestKey.current = null;
            localStorage.removeItem(requestStorageKey);
            setResult({ txHash: data.txHash, subscriptionId: data.subscriptionId, planName: data.planName });
        } catch (err: any) {
            setSubscribeError(friendlyError(err.message || "Failed to subscribe."));
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

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4] flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <AnimatedGradientBg />

            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">subscribe</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Recurring USDC Subscription</p>
                </div>

                {isLoading ? (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
                        <p className="text-xs text-white/40 uppercase tracking-wider mt-4">Loading plan details...</p>
                    </div>
                ) : loadError || !plan ? (
                    <div className="liquid-glass border border-red-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-red-500/[0.02] flex flex-col items-center justify-center text-center gap-6 py-12">
                        <div className="p-4 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-400">
                            <AlertTriangle className="w-10 h-10" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-base font-bold text-white uppercase tracking-wider">Plan Unavailable</h2>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs">
                                {loadError || "This subscription plan could not be found or is no longer active."}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40">

                        {/* Merchant identity */}
                        <div className="flex items-center gap-3">
                            {merchant?.profilePic ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={merchant.profilePic} alt="" className="h-10 w-10 rounded-full object-cover border border-white/10" />
                            ) : (
                                <div className="h-10 w-10 rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center text-[#00d2b4] font-black uppercase">
                                    {(merchant?.name || "M").slice(0, 1)}
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Subscribing to</p>
                                <p className="truncate font-mono text-sm font-bold text-white">{merchant?.name || "Merchant"}</p>
                            </div>
                            {merchant?.verified && (
                                <div className="ml-auto flex items-center gap-1 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg px-2 py-1">
                                    <Shield className="w-3 h-3 text-emerald-400" />
                                    <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">Verified</span>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Plan</span>
                            <h2 className="text-2xl font-extrabold text-white tracking-tight">{plan.name}</h2>
                        </div>

                        {(plan.description || plan.detailsUrl) && (
                            <div className="space-y-2">
                                {plan.description && (
                                    <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line">
                                        {plan.description}
                                    </p>
                                )}
                                {plan.detailsUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setShowLeaveModal(true)}
                                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#00d2b4] transition hover:text-[#00d2b4]/80"
                                    >
                                        <ExternalLink className="w-3 h-3" /> View full details
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex justify-between items-center">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider flex items-center gap-1.5">
                                <RefreshCw className="w-3 h-3" /> {promo ? "Due today" : "Recurring"}
                            </span>
                            <div className="text-right">
                                {promo && (
                                    <p className="text-[10px] font-bold text-white/35 line-through">
                                        {formatAmount(plan.amountUsdc)} USDC
                                    </p>
                                )}
                                <p className="text-2xl font-extrabold text-[#00d2b4] tracking-tight">
                                    {promo ? formatAmount(promo.introductoryAmountUsdc) : formatAmount(plan.amountUsdc)}
                                </p>
                                <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest font-mono">
                                    {promo
                                        ? `USDC today · then ${formatAmount(plan.amountUsdc)} / ${formatPeriod(plan.periodSeconds)}`
                                        : `USDC / ${formatPeriod(plan.periodSeconds)}`}
                                </p>
                            </div>
                        </div>

                        {promo && (
                            <div className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/[0.05] px-4 py-3 space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#00d2b4]">{promo.name}</p>
                                <p className="text-[10px] leading-relaxed text-white/60">
                                    {isFreeTrial
                                        ? <>Your first {promo.introductoryCycles > 1 ? `${promo.introductoryCycles} billing cycles are` : `${formatPeriod(plan.periodSeconds)} is`} <span className="font-bold text-white/85">free</span>.</>
                                        : <>You pay <span className="font-bold text-white/85">{formatAmount(promo.introductoryAmountUsdc)} USDC</span> per {formatPeriod(plan.periodSeconds)} for {promo.introductoryCycles > 1 ? `your first ${promo.introductoryCycles} cycles` : `your first ${formatPeriod(plan.periodSeconds)}`}.</>}{" "}
                                    From <span className="font-bold text-white/85">{firstRegularDate?.toLocaleDateString()}</span> the regular price of{" "}
                                    <span className="font-bold text-white/85">{formatAmount(plan.amountUsdc)} USDC / {formatPeriod(plan.periodSeconds)}</span> applies.
                                    Cancel before then to avoid it.
                                </p>
                            </div>
                        )}

                        <p className="text-[10px] text-white/45 leading-relaxed">
                            You&apos;ll be charged <span className="text-white/70 font-bold">{formatAmount(promo ? promo.introductoryAmountUsdc : plan.amountUsdc)} USDC</span> now and then
                            automatically every <span className="text-white/70 font-bold">{formatPeriod(plan.periodSeconds)}</span>
                            {promo ? <> (at <span className="text-white/70 font-bold">{formatAmount(plan.amountUsdc)} USDC</span> once the introductory period ends)</> : null}. You can cancel
                            anytime from your SubScript dashboard.
                        </p>

                        {Number(plan.minCommitmentSeconds || 0) > 0 && (
                            <p className="rounded-xl border border-[#d4a853]/20 bg-[#d4a853]/5 px-4 py-3 text-[10px] leading-relaxed text-[#d4a853]">
                                This plan has a minimum commitment of{" "}
                                <span className="font-bold">{Math.max(1, Math.round(Number(plan.minCommitmentSeconds) / 86_400))} day{Math.round(Number(plan.minCommitmentSeconds) / 86_400) === 1 ? "" : "s"}</span>.
                                Cancelling before it ends takes effect at the end of your current paid period — you are never billed beyond
                                the period you already approved.
                            </p>
                        )}

                        {result ? (
                            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                                <p className="text-xs font-semibold text-white/80 leading-relaxed">
                                    You&apos;re subscribed to {result.planName || plan.name}!{" "}
                                    {promo && isFreeTrial
                                        ? "Your free period has started — nothing was charged today."
                                        : promo
                                            ? `Your introductory payment of ${formatAmount(promo.introductoryAmountUsdc)} USDC has been taken.`
                                            : "Your first payment has been taken."}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const successUrl = plan.successUrl
                                            ? buildMerchantSuccessUrl(plan.successUrl, plan.id, result)
                                            : null;
                                        successUrl ? window.location.assign(successUrl) : router.push("/user?tab=inbox");
                                    }}
                                    className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-[#00d2b4] hover:brightness-110 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                >
                                    {plan.successUrl ? `Return to ${getHostname(plan.successUrl)}` : "Go to my dashboard"} <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        ) : !sessionLoaded ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-[#00d2b4]" />
                            </div>
                        ) : isEnterpriseViewer ? (
                            <div className="bg-red-500/[0.06] border border-red-500/25 rounded-2xl p-4 flex items-start gap-3">
                                <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                                <p className="text-[10px] text-white/60 leading-relaxed">
                                    You&apos;re signed in as a <span className="font-bold text-red-300">merchant</span> account. Only standard user
                                    accounts can subscribe to a plan. Sign in with a user account to continue.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {subscribeError && (
                                    <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl text-left">
                                        <span className="text-red-400 text-[9px] font-bold uppercase tracking-wide block">Subscription Failed</span>
                                        <p className="text-red-200/70 text-[10px] font-mono mt-1 leading-normal break-words">{subscribeError}</p>
                                    </div>
                                )}

                                {session?.loggedIn && !session.email ? (
                                    <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-left">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200">Verified email required</p>
                                        <p className="text-[10px] leading-relaxed text-white/55">Confirm an email with the emailed OTP before authorizing a recurring payment.</p>
                                        {emailStep === "email" ? <>
                                            <input type="email" value={emailInput} onChange={(event) => { setEmailInput(event.target.value); setEmailError(null); }} placeholder="you@example.com" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white focus:border-[#00d2b4]/50 focus:outline-none" />
                                            <button type="button" onClick={sendEmailCode} disabled={emailBusy} className="w-full rounded-xl bg-white px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50">{emailBusy ? "Sending…" : "Send email code"}</button>
                                        </> : <>
                                            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(event) => { setEmailCode(event.target.value.replace(/\D/g, "")); setEmailError(null); }} placeholder="6-digit code" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-center text-xs tracking-[0.3em] text-white focus:border-[#00d2b4]/50 focus:outline-none" />
                                            <button type="button" onClick={verifyEmailCode} disabled={emailBusy} className="w-full rounded-xl bg-white px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50">{emailBusy ? "Verifying…" : "Verify email"}</button>
                                        </>}
                                        {emailError && <p className="text-[10px] text-red-300" role="alert">{emailError}</p>}
                                    </div>
                                ) : isExternalWalletViewer ? (
                                    <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-left">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200">SubScript wallet required</p>
                                        <p className="text-[10px] leading-relaxed text-white/55">Recurring billing is gas-sponsored from a SubScript email or Google wallet. Browser wallets can pay one-time checkouts, but cannot safely authorize this recurring plan yet.</p>
                                        <button type="button" onClick={handleSignIn} className="w-full rounded-xl bg-white px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-black">Sign in with email or Google</button>
                                    </div>
                                ) : session?.loggedIn ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowSubscribeReview(true)}
                                        disabled={isSubscribing}
                                        className="w-full py-4 bg-gradient-to-r from-[#00d2b4] to-blue-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                    >
                                        {isSubscribing ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up subscription…</>
                                            : <>Review subscription <ArrowRight className="w-4 h-4" /></>}
                                    </button>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-white/40 text-center leading-relaxed">
                                            Sign in or create a free SubScript account to subscribe. Gas is on us.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleSignIn}
                                            className="w-full py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                        >
                                            Sign in to subscribe <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="pt-2 flex items-center justify-center gap-1.5 text-[9px] text-white/30 font-sans">
                            <Lock className="w-3 h-3" /> Secured by the SubScript subscription protocol
                        </div>
                    </div>
                )}
            </div>

            {showSubscribeReview && plan && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" aria-labelledby="subscription-review-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-[#09090b] p-6 shadow-2xl">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00d2b4]">Recurring authorization</p>
                            <h3 id="subscription-review-title" className="mt-1 text-xl font-black text-white">Review subscription</h3>
                        </div>
                        {plan.cancelUrl && !result && (
                            <a href={plan.cancelUrl} className="block text-center text-[10px] text-white/40 underline hover:text-white/70">Cancel and return to {getHostname(plan.cancelUrl)}</a>
                        )}
                        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs">
                            <div className="flex justify-between gap-4"><span className="text-white/45">Merchant</span><span className="text-right font-bold">{merchant?.name || "Merchant"}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-white/45">Charge today</span><span className="font-bold">{formatAmount(promo ? promo.introductoryAmountUsdc : plan.amountUsdc)} USDC</span></div>
                            {promo && (
                                <div className="flex justify-between gap-4"><span className="text-white/45">Regular price</span><span className="font-bold">{formatAmount(plan.amountUsdc)} USDC / {formatPeriod(plan.periodSeconds)}</span></div>
                            )}
                            <div className="flex justify-between gap-4"><span className="text-white/45">Renews</span><span className="font-bold">Every {formatPeriod(plan.periodSeconds)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-white/45">Estimated next charge</span><span className="text-right font-bold">{new Date(Date.now() + Number(plan.periodSeconds) * 1000).toLocaleDateString()}</span></div>
                            {promo && firstRegularDate && (
                                <div className="flex justify-between gap-4"><span className="text-white/45">First full-price renewal</span><span className="text-right font-bold">{firstRegularDate.toLocaleDateString()}</span></div>
                            )}
                        </div>
                        {promo && (
                            <p className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/[0.05] p-3 text-[10px] leading-relaxed text-white/60">
                                You are authorizing both prices now: {isFreeTrial ? "0 USDC" : `${formatAmount(promo.introductoryAmountUsdc)} USDC`} per {formatPeriod(plan.periodSeconds)} during
                                the introductory period, then {formatAmount(plan.amountUsdc)} USDC per {formatPeriod(plan.periodSeconds)}. The price can never
                                exceed what you approve here. Cancel before {firstRegularDate?.toLocaleDateString()} to avoid the regular price.
                            </p>
                        )}
                        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[10px] leading-relaxed text-amber-200/80">Confirming authorizes recurring USDC charges under these terms. You can manage or cancel the subscription from your dashboard; any minimum commitment shown above still applies.</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => setShowSubscribeReview(false)} disabled={isSubscribing} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold text-white">Back</button>
                            <button type="button" onClick={() => { setShowSubscribeReview(false); void handleSubscribe(); }} disabled={isSubscribing} className="rounded-2xl bg-[#00d2b4] px-4 py-3 text-xs font-bold text-black">Confirm subscription</button>
                        </div>
                    </div>
                </div>
            )}

            {showLeaveModal && plan?.detailsUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setShowLeaveModal(false)}
                >
                    <div
                        className="liquid-glass border border-white/10 rounded-3xl p-6 shadow-2xl w-full max-w-sm bg-black/80 space-y-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                                <ShieldAlert className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">You&apos;re leaving SubScript</h3>
                        </div>

                        <div className="space-y-3 text-[11px] leading-relaxed text-white/60">
                            <p>
                                This link opens an external site the merchant controls
                                (<span className="font-mono text-white/80 break-all">{getHostname(plan.detailsUrl)}</span>).
                                SubScript can&apos;t vouch for its content and isn&apos;t responsible for anything that happens there.
                            </p>
                            <p className="font-bold text-white/80">
                                Never enter payment details on that site. All payments for this subscription happen only here, on SubScript.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={handleConfirmLeave}
                                className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                            >
                                OK, I understand <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowLeaveModal(false)}
                                className="w-full py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 transition"
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
