"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, RefreshCw, ExternalLink,
} from "lucide-react";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { isProd } from "@/lib/contracts/constants";

type PlanData = {
    id: string;
    name: string;
    amountUsdc: string;
    periodSeconds: string;
    merchantAddress: string;
    merchant?: {
        address: string;
        name: string;
        alias: string | null;
        profilePic?: string | null;
        verified?: boolean;
        isEnterprise?: boolean;
    };
};

type SessionInfo = { loggedIn: boolean; wallet?: string; email?: string | null; role?: string | null };

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
    const [result, setResult] = useState<{ txHash?: string; subscriptionId?: string; planName?: string } | null>(null);

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
                        amountUsdc: data.plan.amountUsdc,
                        periodSeconds: data.plan.periodSeconds,
                        merchantAddress: data.plan.merchantAddress,
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

    const handleSignIn = () => {
        const next = `/subscribe/${planId}`;
        router.push(`/signin?next=${encodeURIComponent(next)}`);
    };

    const handleSubscribe = async () => {
        if (!plan) return;
        setIsSubscribing(true);
        setSubscribeError(null);
        try {
            const res = await fetch("/api/user/subscription/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: plan.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to subscribe.");
            setResult({ txHash: data.txHash, subscriptionId: data.subscriptionId, planName: data.planName });
        } catch (err: any) {
            setSubscribeError(err.message || "Failed to subscribe.");
        } finally {
            setIsSubscribing(false);
        }
    };

    const merchant = plan?.merchant;
    const isEnterpriseViewer = session?.role === "ENTERPRISE";

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4] flex items-center justify-center p-6 relative font-sans">
            <AnimatedGradientBg />

            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">subscribe</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Recurring USDC Subscription</p>
                </div>

                {isLoading ? (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
                        <p className="text-xs text-white/40 uppercase tracking-wider mt-4">Loading plan details...</p>
                    </div>
                ) : loadError || !plan ? (
                    <div className="liquid-glass border border-red-500/20 rounded-3xl p-8 shadow-2xl bg-red-500/[0.02] flex flex-col items-center justify-center text-center gap-6 py-12">
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
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40">

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

                        <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex justify-between items-center">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider flex items-center gap-1.5">
                                <RefreshCw className="w-3 h-3" /> Recurring
                            </span>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-[#00d2b4] tracking-tight">
                                    ${formatAmount(plan.amountUsdc)}
                                </p>
                                <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest font-mono">
                                    USDC / {formatPeriod(plan.periodSeconds)}
                                </p>
                            </div>
                        </div>

                        <p className="text-[10px] text-white/45 leading-relaxed">
                            You'll be charged <span className="text-white/70 font-bold">${formatAmount(plan.amountUsdc)} USDC</span> now and then
                            automatically every <span className="text-white/70 font-bold">{formatPeriod(plan.periodSeconds)}</span>. You can cancel
                            anytime from your SubScript dashboard.
                        </p>

                        {result ? (
                            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                                <p className="text-xs font-semibold text-white/80 leading-relaxed">
                                    You're subscribed to {result.planName || plan.name}! Your first payment has been taken.
                                </p>
                                {result.txHash && (
                                    <a
                                        href={`${isProd ? "https://arcscan.app" : "https://testnet.arcscan.app"}/tx/${result.txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] font-mono text-[#00d2b4] hover:underline flex items-center gap-1"
                                    >
                                        View transaction <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                                <button
                                    type="button"
                                    onClick={() => router.push("/user?tab=inbox")}
                                    className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-[#00d2b4] hover:brightness-110 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                >
                                    Go to my dashboard <ArrowRight className="w-4 h-4" />
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
                                    You're signed in as a <span className="font-bold text-red-300">merchant</span> account. Only standard user
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

                                {session?.loggedIn ? (
                                    <button
                                        type="button"
                                        onClick={handleSubscribe}
                                        disabled={isSubscribing}
                                        className="w-full py-4 bg-gradient-to-r from-[#00d2b4] to-blue-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                    >
                                        {isSubscribing ? <><Loader2 className="w-4 h-4 animate-spin" /> Subscribing...</>
                                            : <>Subscribe — ${formatAmount(plan.amountUsdc)} USDC <ArrowRight className="w-4 h-4" /></>}
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
        </div>
    );
}
