/* Premium Analytics and Automations Dashboard Component */

import { useMemo, useState, useEffect } from "react";
import { Crown, BarChart3, ArrowUpRight, RefreshCw, Loader2, Sparkles, Save, Lock, Shield } from "@/components/icons";
import Link from "next/link";
import { useSwipeTabs } from "@/hooks/useSwipeTabs";
import type { MerchantAnalyticsSummary, MerchantSubscriptionDetail } from "@/lib/analytics/merchantSubscriptions";

interface AnalyticsDashboardProps {
    isPremium: boolean;
    setActiveTab: (tab: any) => void;
    walletBalance: number;
    vaultBalance: number;
    ledgers: any[];
    analytics: MerchantAnalyticsSummary | null;
    onRetryCharge: (subId: string) => Promise<void>;
    merchantAddress: string;
}

function formatUsdcMicros(value: any) {
    try {
        const micros = BigInt(String(value ?? "0"));
        const unit = BigInt(1_000_000);
        const sign = micros < BigInt(0) ? "-" : "";
        const absolute = micros < BigInt(0) ? -micros : micros;
        const whole = absolute / unit;
        const fraction = (absolute % unit).toString().padStart(6, "0").slice(0, 2);
        return `${sign}${whole.toString()}.${fraction}`;
    } catch {
        return "0.00";
    }
}

function formatUsdcInput(value: any) {
    try {
        const micros = BigInt(String(value ?? "0"));
        const unit = BigInt(1_000_000);
        const sign = micros < BigInt(0) ? "-" : "";
        const absolute = micros < BigInt(0) ? -micros : micros;
        const whole = absolute / unit;
        const fraction = (absolute % unit).toString().padStart(6, "0").replace(/0+$/, "");
        return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
    } catch {
        return "0";
    }
}

function microsToNumber(value: any) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function shortenHash(value: string | undefined) {
    if (!value) return "";
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export default function AnalyticsDashboard({
    isPremium,
    setActiveTab,
    walletBalance,
    vaultBalance,
    ledgers,
    analytics,
    onRetryCharge,
    merchantAddress,
}: AnalyticsDashboardProps) {
    /* Compute metrics based on active subscriptions in ledger */
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<"metrics" | "automations">("metrics");
    /* Mobile thumb-swipe between Metrics & Automations (Premium only — the tabs only exist then). */
    const subTabSwipe = useSwipeTabs(["metrics", "automations"] as const, activeSubTab, setActiveSubTab, { enabled: isPremium });
    const [inactivePage, setInactivePage] = useState(0);
    const [inactiveList, setInactiveList] = useState<Array<{
        id: string;
        address: string;
        timestamp: string;
        retrying: boolean;
        statusLabel: string;
    }>>([]);
    const [inactiveTotalPages, setInactiveTotalPages] = useState(1);
    const [isInactiveLoading, setIsInactiveLoading] = useState(false);
    const [inactiveCursors, setInactiveCursors] = useState<Array<string | null>>([null]);
    const inactiveCursor = inactiveCursors[inactivePage] || null;

    /* Automations Tab States */
    const [isActive, setIsActive] = useState(false);
    const [subjectLine, setSubjectLine] = useState("");
    const [bodyContent, setBodyContent] = useState("");
    const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [responses, setResponses] = useState<any[]>([]);

    /* Metered Vault States */
    const [vaults, setVaults] = useState<any[]>([]);
    const [isVaultsLoading, setIsVaultsLoading] = useState(false);
    const [selectedApiKey, setSelectedApiKey] = useState("");
    const [usageSecretKey, setUsageSecretKey] = useState("");
    const [requiredCommit, setRequiredCommit] = useState("0");
    const [commitInput, setCommitInput] = useState("0");
    const [claimableAmount, setClaimableAmount] = useState("0");
    const [isVaultOpsLoading, setIsVaultOpsLoading] = useState(false);
    const [isSavingCommit, setIsSavingCommit] = useState(false);
    const [isClaimingVault, setIsClaimingVault] = useState(false);
    const [vaultOpsStatus, setVaultOpsStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const fetchVaults = async () => {
        setIsVaultsLoading(true);
        try {
            const res = await fetch("/api/user/vault/config");
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setVaults(data.vaults || []);
                }
            }
        } catch (err) {
            console.error("Failed to load customer vaults:", err);
        } finally {
            setIsVaultsLoading(false);
        }
    };

    const fetchVaultOps = async () => {
        setIsVaultOpsLoading(true);
        try {
            const [commitRes, claimRes] = await Promise.all([
                fetch("/api/merchant/vault/commit-config"),
                fetch("/api/merchant/vault/claim")
            ]);

            const commitData = await commitRes.json().catch(() => null);
            const claimData = await claimRes.json().catch(() => null);

            if (commitRes.ok && commitData?.success) {
                const nextCommit = commitData.commitUsdc || "0";
                setRequiredCommit(nextCommit);
                setCommitInput(formatUsdcInput(nextCommit));
            }
            if (claimRes.ok && claimData?.success) {
                setClaimableAmount(claimData.claimableUsdc || "0");
            }
            if (!commitRes.ok || !claimRes.ok) {
                setVaultOpsStatus({
                    text: commitData?.error || claimData?.error || "Vault controls could not be loaded.",
                    type: "error"
                });
            }
        } catch (err) {
            console.error("Failed to load merchant vault controls:", err);
        } finally {
            setIsVaultOpsLoading(false);
        }
    };

    /* Fetch template settings on mount/tab change */
    useEffect(() => {
        if (activeSubTab === "automations" && isPremium && merchantAddress) {
            const fetchTemplate = async () => {
                setIsLoadingTemplate(true);
                try {
                    const res = await fetch("/api/merchant/automations");
                    if (res.ok) {
                        const data = await res.json();
                        setIsActive(data.is_active || false);
                        setSubjectLine(data.subject_line || "");
                        setBodyContent(data.body_content || "");
                        setResponses(data.responses || []);
                    }
                } catch (err) {
                    console.error("Failed to load automation template:", err);
                } finally {
                    setIsLoadingTemplate(false);
                }
            };

            const fetchApiKeys = async () => {
                try {
                    const res = await fetch("/api/merchant/api-keys");
                    if (res.ok) {
                        const data = await res.json();
                        const keys = data.keys || [];
                        const usableKey = keys.find((key: any) => key.secretKeyAvailable && key.secretKeyPlain);
                        if (usableKey) {
                            setSelectedApiKey(usableKey.secretKeyPlain);
                        } else {
                            setSelectedApiKey("");
                        }
                    }
                } catch (err) {
                    console.error("Failed to load API keys:", err);
                }
            };

            fetchTemplate();
            fetchVaults();
            fetchVaultOps();
            fetchApiKeys();
        }
    }, [activeSubTab, isPremium, merchantAddress]);

    const handleSaveCommitConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        if (commitInput === "" || isNaN(Number(commitInput)) || Number(commitInput) < 0) {
            setVaultOpsStatus({ text: "Required commit must be zero or greater.", type: "error" });
            return;
        }

        setIsSavingCommit(true);
        setVaultOpsStatus(null);
        try {
            const res = await fetch("/api/merchant/vault/commit-config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amountUsdc: commitInput })
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                const nextCommit = data.commitUsdc || "0";
                setRequiredCommit(nextCommit);
                setCommitInput(formatUsdcInput(nextCommit));
                setVaultOpsStatus({
                    text: `Required commit saved. Tx ${shortenHash(data.txHash)}.`,
                    type: "success"
                });
                fetchVaults();
            } else {
                setVaultOpsStatus({ text: data?.error || "Failed to save required commit.", type: "error" });
            }
        } catch (err: any) {
            setVaultOpsStatus({ text: err.message || "Failed to save required commit.", type: "error" });
        } finally {
            setIsSavingCommit(false);
        }
    };

    const handleClaimVaultFunds = async () => {
        setIsClaimingVault(true);
        setVaultOpsStatus(null);
        try {
            const res = await fetch("/api/merchant/vault/claim", { method: "POST" });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                setVaultOpsStatus({
                    text: `Claim submitted. Tx ${shortenHash(data.txHash)}.`,
                    type: "success"
                });
                fetchVaultOps();
                fetchVaults();
            } else {
                setVaultOpsStatus({ text: data?.error || "Failed to claim vault funds.", type: "error" });
            }
        } catch (err: any) {
            setVaultOpsStatus({ text: err.message || "Failed to claim vault funds.", type: "error" });
        } finally {
            setIsClaimingVault(false);
        }
    };

    const surveyStats = useMemo(() => {
        const counts = {
            TOO_EXPENSIVE: 0,
            LACK_OF_FEATURES: 0,
            TECHNICAL_ISSUES: 0,
            OTHER: 0
        };
        responses.forEach((r: any) => {
            const status = r.status as keyof typeof counts;
            if (counts[status] !== undefined) {
                counts[status]++;
            }
        });
        const total = responses.length;
        return {
            counts,
            total,
            percentages: {
                TOO_EXPENSIVE: total ? Math.round((counts.TOO_EXPENSIVE / total) * 100) : 0,
                LACK_OF_FEATURES: total ? Math.round((counts.LACK_OF_FEATURES / total) * 100) : 0,
                TECHNICAL_ISSUES: total ? Math.round((counts.TECHNICAL_ISSUES / total) * 100) : 0,
                OTHER: total ? Math.round((counts.OTHER / total) * 100) : 0
            }
        };
    }, [responses]);

    const handleSaveTemplate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSavingTemplate(true);
        setStatusMessage(null);
        try {
            const res = await fetch("/api/merchant/automations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    isActive,
                    subjectLine,
                    bodyContent,
                })
            });
            if (res.ok) {
                setStatusMessage({ text: "Automations settings updated successfully.", type: "success" });
            } else {
                const data = await res.json();
                setStatusMessage({ text: data.error || "Failed to save automations settings.", type: "error" });
            }
        } catch (err: any) {
            setStatusMessage({ text: err.message || "Something went wrong.", type: "error" });
        } finally {
            setIsSavingTemplate(false);
        }
    };

    const insertVariableToSubject = (variable: string) => {
        setSubjectLine((prev) => prev + ` {{${variable}}}`);
    };

    const insertVariableToBody = (variable: string) => {
        setBodyContent((prev) => prev + ` {{${variable}}}`);
    };

    const handleRetryClick = async (id: string) => {
        setRetryingId(id);
        try {
            await onRetryCharge(id);
        } catch (err) {
            console.error(err);
        } finally {
            setRetryingId(null);
        }
    };

    /* A sub generates recurring revenue only when it is active on-chain, its mirror status is
       ACTIVE, it is not mid-failed-renewal (downgradeFailures === 0 — the period has lapsed and
       the renewal hasn't collected), and it is not scheduled to end. PAST_DUE (parked),
       actively-failing, ending, and ended subs are all excluded so revenue reflects money that
       is actually recurring. */
    const isPaying = (sub: any) =>
        sub.active
        && sub.billingStatus === "ACTIVE"
        && Number(sub.downgradeFailures || 0) === 0
        && !sub.cancelAtPeriodEnd;

    /* Mirror the retry ceiling from cron/customer-billing for the attention-state label. */
    const MAX_RENEWAL_FAILURES = 4;
    const monthlyOf = (sub: any) =>
        (parseFloat(sub.rawAmount) || 0) * (2592000 / (parseFloat(sub.rawPeriod) || 2592000));

    const activeSubscribers = useMemo(
        () => analytics?.renewingSubscriptions ?? ledgers.filter(isPaying).length,
        [analytics, ledgers],
    );

    const mrr = useMemo(() => {
        return analytics?.mrrUsdc
            ?? ledgers.reduce((acc, sub) => (isPaying(sub) ? acc + monthlyOf(sub) : acc), 0);
    }, [analytics, ledgers]);

    /* Annual run rate = current monthly recurring revenue × 12. Honest, derived from live ledgers. */
    const annualRunRate = useMemo(() => mrr * 12, [mrr]);

    /* Average monthly revenue per active subscriber. */
    const arpu = useMemo(() => (activeSubscribers > 0 ? mrr / activeSubscribers : 0), [mrr, activeSubscribers]);

    /* Calculate dynamic retention rate from ledger count */
    const stats = useMemo(() => {
        const total = analytics?.totalSubscriptions ?? ledgers.length;
        if (total === 0) {
            return { churn: 0.0, retention: 100.0 };
        }
        const active = analytics?.renewingSubscriptions ?? ledgers.filter(isPaying).length;
        const inactive = total - active;
        const churn = (inactive / total) * 100;
        const retention = 100 - churn;
        return { churn, retention };
    }, [analytics, ledgers]);

    /* Dynamic SVG stroke offset based on actual retention rate */
    const strokeDashoffset = useMemo(() => {
        return 251.2 - (251.2 * stats.retention) / 100;
    }, [stats.retention]);

    /* Real revenue mix: each bar is a top paying subscriber's monthly recurring contribution.
       Heights are relative to the largest; the actual dollar amount and subscriber are surfaced
       so the chart shows accurate detail, not just anonymous relative bars. No fabricated history. */
    const revenueBars = useMemo(() => {
        const top = analytics
            ? analytics.topRevenue.map((subscription) => ({
                monthly: subscription.monthlyUsdc,
                label: subscription.subscriberName
                    || (subscription.subscriber
                        ? `${subscription.subscriber.slice(0, 6)}...${subscription.subscriber.slice(-4)}`
                        : "Subscriber"),
            }))
            : ledgers
                .filter(isPaying)
                .map((s: any) => ({
                    monthly: monthlyOf(s),
                    label: s.shortSubAddress || s.displayAddress || "Subscriber",
                }))
                .sort((a, b) => b.monthly - a.monthly)
                .slice(0, 6);
        const maxVal = top.length ? Math.max(...top.map((t) => t.monthly)) : 0;
        const bars = top.map((t) => ({
            height: maxVal > 0 ? (t.monthly / maxVal) * 100 : 0,
            monthly: t.monthly,
            label: t.label,
        }));
        while (bars.length < 6) bars.push({ height: 0, monthly: 0, label: "" });
        return bars;
    }, [analytics, ledgers]);

    /* Display subscribers actually generating revenue, ordered by their real latest settlement
       timestamp (or creation time before the first renewal). */
    const displayList = useMemo(() => {
        if (analytics) {
            return analytics.recentSubscribers.map((subscription) => ({
                address: subscription.subscriberName
                    || (subscription.subscriber
                        ? `${subscription.subscriber.slice(0, 6)}...${subscription.subscriber.slice(-4)}`
                        : "Unknown subscriber"),
                tier: 1, /* Active subscribers of standard subscription represent tier 1 setup */
                timestamp: new Date(subscription.activityAt).toLocaleDateString(),
            }));
        }
        return ledgers
            .filter(isPaying)
            .slice()
            .sort((a: any, b: any) => new Date(b.activityAt || 0).getTime() - new Date(a.activityAt || 0).getTime())
            .slice(0, 5)
            .map((sub: any) => ({
                address: sub.shortSubAddress || "0x0000...0000",
                tier: 1,
                timestamp: sub.activityAt ? new Date(sub.activityAt).toLocaleDateString() : "Unknown",
            }));
    }, [analytics, ledgers]);

    /* Everything not currently paying: actively-retrying (still ACTIVE, renewal failing),
       ending (cancel-at-period-end), parked (PAST_DUE — retries stopped), and ended subs.
       Only the genuinely auto-retrying ones get the "Auto-retrying" treatment — a PAST_DUE sub
       is parked, not retrying, so it is labelled "Past due" instead. */
    useEffect(() => {
        if (!merchantAddress || !isPremium) {
            setInactiveList([]);
            setInactiveTotalPages(1);
            setInactivePage(0);
            setInactiveCursors([null]);
            return;
        }
        let cancelled = false;
        setIsInactiveLoading(true);
        const cursorParam = inactiveCursor ? `&cursor=${encodeURIComponent(inactiveCursor)}` : "";
        fetch(`/api/merchant/subscriptions?scope=attention&pageSize=5${cursorParam}`)
            .then(async (response) => {
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || "Inactive subscriptions could not be loaded");
                }
                if (cancelled) return;
                const totalPages = Math.max(1, Number(payload.pagination?.totalPages || 1));
                if (inactivePage >= totalPages) {
                    setInactivePage(totalPages - 1);
                    return;
                }
                const rows = (payload.subscriptions || []).map((subscription: MerchantSubscriptionDetail) => {
                    const retrying = subscription.status === "ACTIVE"
                        && subscription.downgradeFailures > 0
                        && !subscription.cancelAtPeriodEnd;
                    const attempts = Number(subscription.downgradeFailures || 0);
                    const fallbackAddress = subscription.subscriber
                        ? `${subscription.subscriber.slice(0, 6)}...${subscription.subscriber.slice(-4)}`
                        : "Unknown subscriber";
                    return {
                        id: subscription.subscriptionId,
                        address: subscription.subscriberName || fallbackAddress,
                        timestamp: subscription.nextBillingDate
                            ? new Date(subscription.nextBillingDate).toLocaleDateString()
                            : "Not scheduled",
                        retrying,
                        statusLabel: retrying
                            ? `Auto-retrying (${Math.min(attempts, MAX_RENEWAL_FAILURES)}/${MAX_RENEWAL_FAILURES})`
                            : subscription.cancelAtPeriodEnd
                                ? "Ends at renewal"
                                : subscription.status === "PAST_DUE"
                                    ? "Past due — paused"
                                    : subscription.status === "CANCELED"
                                        ? "Canceled"
                                        : "Payment overdue",
                    };
                });
                setInactiveList(rows);
                setInactiveTotalPages(totalPages);
                const nextCursor = payload.pagination?.nextCursor || null;
                setInactiveCursors((current) => {
                    const updated = current.slice(0, inactivePage + 1);
                    if (nextCursor) updated[inactivePage + 1] = String(nextCursor);
                    return updated;
                });
            })
            .catch((error) => {
                if (!cancelled) console.error("Inactive subscription lookup failed:", error);
            })
            .finally(() => {
                if (!cancelled) setIsInactiveLoading(false);
            });
        return () => { cancelled = true; };
    }, [inactiveCursor, inactivePage, isPremium, merchantAddress]);

    return (
        <div className="space-y-6 relative max-w-[1400px] mx-auto">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#00d2b4]" />
                        Premium Analytics Dashboard
                    </h2>
                    <p className="text-[10px] text-white/40 mt-1">
                        Real-time revenue, subscriber logs, and payment performance details.
                    </p>
                </div>

                {/* Sub-tab navigation header */}
                {isPremium && (
                    <div className="flex gap-1.5 bg-white/[0.02] border border-white/5 p-1 rounded-xl shrink-0">
                        <button
                            type="button"
                            onClick={() => setActiveSubTab("metrics")}
                            className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-200 ${
                                activeSubTab === "metrics"
                                    ? "bg-white/10 text-white border border-white/5"
                                    : "text-white/40 hover:text-white/80"
                            }`}
                        >
                            Metrics & Logs
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveSubTab("automations")}
                            className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-200 ${
                                activeSubTab === "automations"
                                    ? "bg-white/10 text-white border border-white/5"
                                    : "text-white/40 hover:text-white/80"
                            }`}
                        >
                            Automations
                        </button>
                    </div>
                )}
            </div>

            {/* Container wrapper for blur and overlay control */}
            <div className="relative rounded-3xl overflow-hidden min-h-[580px]">
                {/* Blur overlay when Tier 0 */}
                {!isPremium && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-black/60 z-20 gap-5 backdrop-blur-[2px]">
                        <div className="p-4 rounded-3xl bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] animate-pulse">
                            <Crown className="w-10 h-10" />
                        </div>
                        <div className="space-y-2 max-w-sm">
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Analytics Locked</h3>
                            <p className="text-xs text-white/60 leading-relaxed font-sans">
                                Detailed analytics, subscriber retention metrics, and payment projections are exclusive Premium features. Upgrade your merchant account to unlock them.
                            </p>
                        </div>
                        <button
                            onClick={() => setActiveTab("premium")}
                            className="px-6 py-2.5 bg-[#d4a853] hover:bg-[#d4a853]/80 text-black rounded-2xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(212,168,83,0.2)]"
                        >
                            <Crown className="w-3.5 h-3.5" />
                            Upgrade to Premium
                        </button>
                    </div>
                )}

                {/* Dashboard layout */}
                <div className={`transition-all duration-300 ${isPremium ? "" : "filter blur-[6px] pointer-events-none select-none"}`} {...subTabSwipe}>
                    {activeSubTab === "metrics" ? (
                        <div className="space-y-6">
                            {/* Top Row: 2 columns, asymmetrical on desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Top Left Card: spans 2 columns on desktop */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl relative overflow-hidden col-span-1 md:col-span-2 flex flex-col justify-between min-h-[240px]">
                                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Annual Run Rate</p>
                                            <p className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">${annualRunRate.toFixed(2)}</p>
                                        </div>
                                        <div className="text-left sm:text-right">
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Monthly Recurring Revenue</p>
                                            <p className="text-xl sm:text-2xl font-bold text-[#00d2b4] font-mono">${mrr.toFixed(2)}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mt-8">
                                        <p className="text-[9px] text-white/30 max-w-md">
                                            Annualized from your active recurring revenue · Claimable settlement: ${vaultBalance.toFixed(2)}
                                        </p>
                                        <button
                                            onClick={() => setActiveTab("overview")}
                                            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white rounded-2xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                                        >
                                            View Full Report
                                            <ArrowUpRight className="w-3.5 h-3.5 text-[#00d2b4]" />
                                        </button>
                                    </div>
                                </div>

                                {/* Top Right Card: spans 1 column on desktop */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl relative overflow-hidden col-span-1 flex flex-col justify-between min-h-[240px]">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Active Subscriptions</p>
                                                <p className="text-3xl font-extrabold text-white tracking-tight">{activeSubscribers}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">All-Time Churn</p>
                                                <p className="text-xl font-bold text-white/90">{stats.churn.toFixed(1)}%</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Avg Revenue / Subscriber</p>
                                                <p className="text-xl font-bold text-white/90">${arpu.toFixed(2)}<span className="text-[10px] text-white/40 font-normal">/mo</span></p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-center pt-2">
                                            <svg viewBox="0 0 100 100" className="w-24 h-24">
                                                <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.03)" strokeWidth="8" fill="transparent" />
                                                <circle cx="50" cy="50" r="40" stroke="#00d2b4" strokeWidth="8" fill="transparent" strokeDasharray="251.2" strokeDashoffset={strokeDashoffset} strokeLinecap="round" className="transform -rotate-90 origin-center" />
                                                <text x="50" y="55" textAnchor="middle" fill="white" className="text-xs font-bold font-mono">{stats.retention.toFixed(1)}%</text>
                                            </svg>
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-white/30 font-sans mt-4">
                                        Share of all subscriptions ever created that are still active
                                    </p>
                                </div>
                            </div>

                            {/* Bottom Row: 3 columns, symmetrical on desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Bottom Left Card: Performance Chart */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Revenue by Subscriber</p>
                                        <p className="text-xs text-white/60">Top active monthly contributions</p>
                                    </div>
                                    
                                    <div className="flex items-end justify-between h-40 pt-6 px-1">
                                        {revenueBars.map((bar, idx) => (
                                            <div key={idx} className="flex flex-col items-center gap-1.5 flex-1 group" title={bar.monthly > 0 ? `${bar.label} · $${bar.monthly.toFixed(2)}/mo` : ""}>
                                                <span className="text-[8px] text-[#00d2b4]/80 font-mono font-bold h-3">
                                                    {bar.monthly > 0 ? `$${bar.monthly.toFixed(bar.monthly < 100 ? 2 : 0)}` : ""}
                                                </span>
                                                <div
                                                    className="w-7 bg-[#00d2b4]/15 border border-[#00d2b4]/30 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/40"
                                                    style={{ height: `${bar.height}%` }}
                                                ></div>
                                                <span className="text-[8px] text-white/40 font-mono truncate max-w-[44px]">
                                                    {bar.label || `#${idx + 1}`}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <p className="text-[9px] text-white/30 font-sans mt-4">
                                        Each bar is a top subscriber&apos;s monthly recurring revenue
                                    </p>
                                </div>

                                {/* Bottom Center Card: List View */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Recent Subscribers</p>
                                        <p className="text-xs text-white/60">Currently renewing subscriptions</p>
                                    </div>

                                    <div className="space-y-3 my-4">
                                        {displayList.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-48 text-white/30 text-xs">
                                                No active subscribers
                                            </div>
                                        ) : (
                                            displayList.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-7 h-7 rounded-full bg-[#d4a853]/10 border border-[#d4a853]/20 flex items-center justify-center text-[9px] text-[#d4a853] font-bold">
                                                            T{item.tier}
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-mono text-white/90">{item.address}</p>
                                                            <p className="text-[8px] text-white/30">{item.timestamp}</p>
                                                        </div>
                                                    </div>
                                                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-[#00d2b4]/10 text-[#00d2b4] border border-[#00d2b4]/20 uppercase">
                                                        Active
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <p className="text-[9px] text-white/30 font-sans">
                                        Sorted by latest settlement transaction
                                    </p>
                                </div>

                                {/* Bottom Right Card: Inactive Subscriptions */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Inactive Subscriptions</p>
                                        <p className="text-xs text-white/60">Past-due and ended accounts</p>
                                    </div>

                                    <div className="space-y-3 my-4 overflow-y-auto max-h-[280px]">
                                        {isInactiveLoading ? (
                                            <div className="flex items-center justify-center h-36 text-white/30 text-xs gap-2">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading subscriptions
                                            </div>
                                        ) : inactiveList.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-36 text-white/30 text-xs">
                                                No inactive subscriptions
                                            </div>
                                        ) : (
                                            (() => {
                                                return inactiveList.map((item) => (
                                                    <div key={item.id} className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-[9px] text-red-400 font-bold font-mono">
                                                                ID{item.id}
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-mono text-white/90">{item.address}</p>
                                                                <p className="text-[8px] text-white/30">Due: {item.timestamp}</p>
                                                            </div>
                                                        </div>
                                                        <span className={`px-4 py-2 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                                                            item.retrying ? "text-amber-300" : "text-white/30"
                                                        }`}>
                                                            {item.retrying && <RefreshCw className="w-3 h-3" />}
                                                            {item.statusLabel}
                                                        </span>
                                                    </div>
                                                ));
                                            })()
                                        )}
                                    </div>

                                    {(() => {
                                        const totalPages = inactiveTotalPages;
                                        if (totalPages <= 1) return null;
                                        return (
                                            <div className="flex items-center justify-between pt-3 mt-1 border-t border-white/5 font-sans mb-3">
                                                <span className="text-[9px] text-white/40 uppercase font-bold tracking-wider">
                                                    Page {inactivePage + 1} of {totalPages}
                                                </span>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={inactivePage === 0}
                                                        onClick={() => setInactivePage((p) => Math.max(0, p - 1))}
                                                        className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all"
                                                    >
                                                        Prev
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={inactivePage >= totalPages - 1}
                                                        onClick={() => setInactivePage((p) => Math.min(totalPages - 1, p + 1))}
                                                        className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all"
                                                    >
                                                        Next
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <p className="text-[9px] text-white/30 font-sans">
                                        Manual on-chain execution of overdue payment
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Automations Tab Content */
                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl min-h-[480px] flex flex-col justify-between relative overflow-hidden">
                            {!isPremium && (
                                <div className="absolute inset-0 bg-[#0a0a0c]/80 backdrop-blur-md z-20 flex flex-col items-center justify-center text-center p-6 gap-4 border border-white/5">
                                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-2xl">
                                        <Lock className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Privacy Premium Feature</h3>
                                        <p className="text-[10px] text-white/55 max-w-xs leading-relaxed">
                                            Automated exit surveys and churn recovery templates are exclusive to the Privacy Premium tier. Upgrade your account to unlock automations.
                                        </p>
                                    </div>
                                    <Link
                                        href="/merchant/upgrade"
                                        className="px-6 py-2.5 bg-yellow-300 hover:bg-yellow-200 text-black rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg shadow-yellow-500/15"
                                    >
                                        Upgrade Now
                                    </Link>
                                </div>
                            )}

                            {isLoadingTemplate ? (
                                <div className="flex flex-col items-center justify-center h-80 text-white/40 gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
                                    <span className="text-xs uppercase tracking-wider font-bold font-mono">Loading Automations Config...</span>
                                </div>
                            ) : (
                                <form onSubmit={handleSaveTemplate} className="space-y-6">
                                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                        <div>
                                            <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                                <Sparkles className="w-4 h-4 text-[#00d2b4]" />
                                                Automated Churn Recovery Exit Survey
                                            </h3>
                                            <p className="text-[10px] text-white/40 mt-1">
                                                Send an exit survey automatically to customers when their subscription is cancelled or expired.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!isPremium}
                                            onClick={() => setIsActive(!isActive)}
                                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                isActive ? "bg-[#00d2b4]" : "bg-white/10"
                                            } ${!isPremium ? "opacity-50 cursor-not-allowed" : ""}`}
                                            aria-label="Toggle exit survey"
                                        >
                                            <span
                                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                                                    isActive ? "translate-x-5" : "translate-x-0"
                                                }`}
                                            />
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <div className="flex justify-between items-center">
                                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Subject Line</label>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[8px] text-white/30 uppercase font-mono">Variables:</span>
                                                    <button
                                                        type="button"
                                                        disabled={!isPremium}
                                                        onClick={() => insertVariableToSubject("customer_wallet")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        customer_wallet
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!isPremium}
                                                        onClick={() => insertVariableToSubject("subscription_tier")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        subscription_tier
                                                    </button>
                                                </div>
                                            </div>
                                            <input
                                                type="text"
                                                required
                                                disabled={!isPremium}
                                                placeholder="e.g. We want to hear your feedback"
                                                value={subjectLine}
                                                onChange={(e) => setSubjectLine(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="flex justify-between items-center">
                                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Email Content (Plain Text)</label>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[8px] text-white/30 uppercase font-mono">Variables:</span>
                                                    <button
                                                        type="button"
                                                        disabled={!isPremium}
                                                        onClick={() => insertVariableToBody("customer_wallet")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        customer_wallet
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!isPremium}
                                                        onClick={() => insertVariableToBody("subscription_tier")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        subscription_tier
                                                    </button>
                                                </div>
                                            </div>
                                            <textarea
                                                required
                                                rows={8}
                                                disabled={!isPremium}
                                                placeholder="Enter exit survey message here..."
                                                value={bodyContent}
                                                onChange={(e) => setBodyContent(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors text-xs font-sans whitespace-pre-wrap leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-4 border-t border-white/5">
                                        <div className="min-h-5">
                                            {statusMessage && (
                                                <p className={`text-[10px] font-bold tracking-wide ${
                                                    statusMessage.type === "success" ? "text-emerald-400" : "text-red-400"
                                                }`}>
                                                    {statusMessage.text}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={isSavingTemplate || !isPremium}
                                            className="px-6 py-2.5 bg-[#00d2b4] text-[#111111] hover:brightness-110 disabled:opacity-50 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all shrink-0"
                                        >
                                            {isSavingTemplate ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Save className="w-3.5 h-3.5" />
                                            )}
                                            {isSavingTemplate ? "Saving..." : "Save Automations Settings"}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {isPremium && surveyStats.total > 0 && (
                                <div className="mt-8 border-t border-white/5 pt-6 space-y-5">
                                    <div>
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-[#00d2b4]" />
                                            Exit Survey Responses ({surveyStats.total})
                                        </h4>
                                        <p className="text-[9px] text-white/40 mt-1 uppercase tracking-wider">
                                            Real-time user feedback compiled from automated in-app churn chats.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Left Side: Progress Bars */}
                                        <div className="space-y-3.5 bg-black/20 border border-white/5 rounded-2xl p-5">
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-white/60 font-bold uppercase tracking-wide">Too Expensive</span>
                                                    <span className="text-[#00d2b4] font-black">{surveyStats.percentages.TOO_EXPENSIVE}% ({surveyStats.counts.TOO_EXPENSIVE})</span>
                                                </div>
                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-[#00d2b4] rounded-full transition-all duration-500" style={{ width: `${surveyStats.percentages.TOO_EXPENSIVE}%` }}></div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-white/60 font-bold uppercase tracking-wide">Lack of Features</span>
                                                    <span className="text-[#00d2b4] font-black">{surveyStats.percentages.LACK_OF_FEATURES}% ({surveyStats.counts.LACK_OF_FEATURES})</span>
                                                </div>
                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-[#00d2b4] rounded-full transition-all duration-500" style={{ width: `${surveyStats.percentages.LACK_OF_FEATURES}%` }}></div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-white/60 font-bold uppercase tracking-wide">Technical Issues</span>
                                                    <span className="text-[#00d2b4] font-black">{surveyStats.percentages.TECHNICAL_ISSUES}% ({surveyStats.counts.TECHNICAL_ISSUES})</span>
                                                </div>
                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-[#00d2b4] rounded-full transition-all duration-500" style={{ width: `${surveyStats.percentages.TECHNICAL_ISSUES}%` }}></div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-white/60 font-bold uppercase tracking-wide">Other</span>
                                                    <span className="text-[#00d2b4] font-black">{surveyStats.percentages.OTHER}% ({surveyStats.counts.OTHER})</span>
                                                </div>
                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-[#00d2b4] rounded-full transition-all duration-500" style={{ width: `${surveyStats.percentages.OTHER}%` }}></div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right Side: Feed of Recent Responses */}
                                        <div className="bg-black/20 border border-white/5 rounded-2xl p-5 flex flex-col justify-between overflow-hidden">
                                            <span className="text-[9px] font-bold text-white/50 uppercase tracking-widest block mb-3 border-b border-white/5 pb-2">Recent Feedback Logs</span>
                                            <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                                                {responses.slice(0, 5).map((resp: any) => (
                                                    <div key={resp.id} className="flex justify-between items-center text-[10px] bg-white/[0.02] border border-white/5 rounded-xl p-2.5">
                                                        <div>
                                                            <p className="font-mono text-white/80 truncate max-w-[120px] sm:max-w-[180px]">{resp.receiver_address}</p>
                                                            <p className="text-[8px] text-white/30">{new Date(resp.updated_at).toLocaleDateString()}</p>
                                                        </div>
                                                        <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#00d2b4]/10 text-[#00d2b4] border border-[#00d2b4]/15">
                                                            {resp.status.replace(/_/g, " ")}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {isPremium && (
                                <div className="mt-8 border-t border-white/5 pt-6 space-y-5 text-left">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                                <Shield className="w-4 h-4 text-[#00d2b4]" />
                                                Metered Vaults ({vaults.length})
                                            </h4>
                                            <p className="text-[9px] text-white/40 mt-1 uppercase tracking-wider">
                                                Customer escrow, accrued usage, owed debt, and merchant claim controls.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                fetchVaultOps();
                                                fetchVaults();
                                            }}
                                            disabled={isVaultOpsLoading || isVaultsLoading}
                                            className="self-start px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] disabled:opacity-50 text-[9px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5 transition"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${(isVaultOpsLoading || isVaultsLoading) ? "animate-spin" : ""}`} />
                                            Refresh
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                        <form onSubmit={handleSaveCommitConfig} className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Required Commit</p>
                                                <p className="text-[9px] text-white/35 mt-1">
                                                    Minimum escrow each customer must restore before usage can continue.
                                                </p>
                                            </div>
                                            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                                                <label className="flex-1 space-y-1.5">
                                                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">USDC</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.000001"
                                                        value={commitInput}
                                                        onChange={(e) => setCommitInput(e.target.value)}
                                                        disabled={isSavingCommit}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#00d2b4] transition text-sm font-mono disabled:opacity-50"
                                                        placeholder="0"
                                                    />
                                                </label>
                                                <button
                                                    type="submit"
                                                    disabled={isSavingCommit}
                                                    className="px-5 py-2 bg-[#00d2b4] text-[#111111] hover:brightness-110 disabled:opacity-50 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                                >
                                                    {isSavingCommit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                    Save Commit
                                                </button>
                                            </div>
                                            <p className="text-[9px] text-white/35 uppercase tracking-wider">
                                                Current on-chain setting: <span className="font-mono text-[#ccff00]">${formatUsdcMicros(requiredCommit)} USDC</span>
                                            </p>
                                        </form>

                                        <div className="rounded-2xl border border-white/5 bg-black/20 p-5 flex flex-col justify-between gap-4">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Claimable Settled Funds</p>
                                                <p className="text-3xl font-black text-white mt-2">${formatUsdcMicros(claimableAmount)}</p>
                                                <p className="text-[9px] text-white/35 mt-1">
                                                    Funds become claimable after the keeper draws accrued cycle usage from escrow.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleClaimVaultFunds}
                                                disabled={isClaimingVault || isVaultOpsLoading || microsToNumber(claimableAmount) <= 0}
                                                className="px-5 py-2 bg-white/[0.08] border border-white/10 hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                            >
                                                {isClaimingVault ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5 text-[#00d2b4]" />}
                                                Claim Funds
                                            </button>
                                        </div>

                                        <div className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Usage Test Key</p>
                                                <p className="text-[9px] text-white/35 mt-1">
                                                    Paste a one-time revealed secret key to test usage reports from this dashboard.
                                                </p>
                                            </div>
                                            <label className="block space-y-1.5">
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">Secret key</span>
                                                <input
                                                    type="password"
                                                    value={usageSecretKey}
                                                    onChange={(e) => setUsageSecretKey(e.target.value)}
                                                    autoComplete="off"
                                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#00d2b4] transition text-xs font-mono"
                                                    placeholder="sk_test_..."
                                                />
                                            </label>
                                            <p className="text-[9px] text-white/30">
                                                Stored keys are only returned as hints after creation; this field stays in local component state.
                                            </p>
                                        </div>
                                    </div>

                                    {vaultOpsStatus && (
                                        <p className={`text-[10px] font-bold tracking-wide ${
                                            vaultOpsStatus.type === "success" ? "text-emerald-400" : "text-red-400"
                                        }`}>
                                            {vaultOpsStatus.text}
                                        </p>
                                    )}

                                    {isVaultsLoading ? (
                                        <div className="flex h-24 items-center justify-center">
                                            <Loader2 className="h-5 w-5 animate-spin text-[#00d2b4]" />
                                        </div>
                                    ) : vaults.length === 0 ? (
                                        <div className="flex h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center p-4">
                                            <p className="text-xs text-white/45">No customers have committed escrow to your metered service yet.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 gap-3">
                                                {vaults.map((vault) => (
                                                    <CustomerVaultRow
                                                        key={vault.id}
                                                        vault={vault}
                                                        apiKey={usageSecretKey.trim() || selectedApiKey}
                                                        onRefresh={fetchVaults}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function CustomerVaultRow({
    vault,
    apiKey,
    onRefresh,
}: {
    vault: any;
    apiKey: string;
    onRefresh: () => void;
}) {
    const [chargeAmount, setChargeAmount] = useState("1.50");
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const handleReportUsage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) {
            setStatus({ text: "A newly revealed secret key is required to test usage reporting. Roll or create an API key and copy it while it is shown.", type: "error" });
            return;
        }
        if (!chargeAmount || isNaN(Number(chargeAmount)) || Number(chargeAmount) <= 0) {
            setStatus({ text: "Invalid usage amount.", type: "error" });
            return;
        }

        setLoading(true);
        setStatus(null);

        try {
            const res = await fetch("/api/user/vault/report-usage", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    userAddress: vault.userAddress,
                    amountUsdc: chargeAmount
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setStatus({
                    text: `Usage accrued. Cycle total: $${formatUsdcMicros(data.accruedUsageUsdc)} USDC.`,
                    type: "success"
                });
                onRefresh();
            } else {
                setStatus({ text: data.error || "Usage report failed.", type: "error" });
            }
        } catch (err: any) {
            setStatus({ text: err.message || "Failed to report usage.", type: "error" });
        } finally {
            setLoading(false);
        }
    };

    const cycleStart = vault.cycleStart ? new Date(vault.cycleStart).toLocaleDateString() : "Not started";
    const owedMicros = microsToNumber(vault.owedUsdc);
    const isActive = Boolean(vault.active);

    return (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-black/20 hover:bg-black/35 hover:border-white/10 transition p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-mono text-white/90 truncate max-w-xs">{vault.userName || vault.userAddress}</p>
                        <span className={`px-2 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-wider ${
                            isActive
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                : "border-red-400/20 bg-red-400/10 text-red-300"
                        }`}>
                            {isActive ? "Active" : "Blocked"}
                        </span>
                    </div>
                    <p className="text-[9px] text-white/30 mt-1 font-mono">{vault.userAddress}</p>
                </div>

                <form onSubmit={handleReportUsage} className="flex flex-col gap-2 shrink-0 lg:items-end">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            step="any"
                            min="0"
                            value={chargeAmount}
                            onChange={(e) => setChargeAmount(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-[#00d2b4] transition text-xs w-24 text-center"
                            placeholder="1.50"
                            required
                        />
                        <button
                            type="submit"
                            disabled={loading || !isActive}
                            className="px-4 py-1.5 bg-[#00d2b4] text-[#111111] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                        >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Report Usage"}
                        </button>
                    </div>
                    {status && (
                        <span className={`max-w-xs text-left lg:text-right text-[9px] font-bold tracking-wide ${
                            status.type === "success" ? "text-emerald-400" : "text-red-400"
                        }`}>
                            {status.text}
                        </span>
                    )}
                </form>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-[8px] uppercase tracking-wider text-white/35 font-bold">Escrow Balance</p>
                    <p className="text-sm font-black text-[#ccff00] mt-1">${formatUsdcMicros(vault.balanceUsdc)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-[8px] uppercase tracking-wider text-white/35 font-bold">Required Commit</p>
                    <p className="text-sm font-black text-white mt-1">${formatUsdcMicros(vault.commitUsdc)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-[8px] uppercase tracking-wider text-white/35 font-bold">Accrued Usage</p>
                    <p className="text-sm font-black text-[#00d2b4] mt-1">${formatUsdcMicros(vault.accruedUsageUsdc)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-[8px] uppercase tracking-wider text-white/35 font-bold">Owed</p>
                    <p className={`text-sm font-black mt-1 ${owedMicros > 0 ? "text-red-300" : "text-white"}`}>${formatUsdcMicros(vault.owedUsdc)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-[8px] uppercase tracking-wider text-white/35 font-bold">Cycle Start</p>
                    <p className="text-xs font-bold text-white/70 mt-1">{cycleStart}</p>
                </div>
            </div>
        </div>
    );
}
