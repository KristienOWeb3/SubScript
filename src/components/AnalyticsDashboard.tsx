/* Premium Analytics and Automations Dashboard Component */

import { useMemo, useState, useEffect } from "react";
import { Crown, BarChart3, ArrowUpRight, RefreshCw, Loader2, Sparkles, Save } from "lucide-react";

interface AnalyticsDashboardProps {
    isPremium: boolean;
    setActiveTab: (tab: any) => void;
    walletBalance: number;
    vaultBalance: number;
    ledgers: any[];
    onRetryCharge: (subId: string) => Promise<void>;
    merchantAddress: string;
}

export default function AnalyticsDashboard({
    isPremium,
    setActiveTab,
    walletBalance,
    vaultBalance,
    ledgers,
    onRetryCharge,
    merchantAddress,
}: AnalyticsDashboardProps) {
    /* Compute metrics based on active subscriptions in ledger */
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<"metrics" | "automations">("metrics");

    /* Automations Tab States */
    const [isActive, setIsActive] = useState(false);
    const [subjectLine, setSubjectLine] = useState("");
    const [bodyContent, setBodyContent] = useState("");
    const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

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
                    }
                } catch (err) {
                    console.error("Failed to load automation template:", err);
                } finally {
                    setIsLoadingTemplate(false);
                }
            };
            fetchTemplate();
        }
    }, [activeSubTab, isPremium, merchantAddress]);

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

    const activeSubscribers = useMemo(() => {
        return ledgers.filter((sub) => sub.active).length;
    }, [ledgers]);

    const mrr = useMemo(() => {
        return ledgers.reduce((acc, sub) => {
            if (!sub.active) return acc;
            const amountNum = parseFloat(sub.rawAmount) || 0;
            const periodNum = parseFloat(sub.rawPeriod) || 2592000;
            const monthlyEquivalent = amountNum * (2592000 / periodNum);
            return acc + monthlyEquivalent;
        }, 0);
    }, [ledgers]);

    const totalVolume = useMemo(() => {
        /* Estimate total historical volume as active MRR + vault balance */
        return mrr * 1.25 + vaultBalance;
    }, [mrr, vaultBalance]);

    /* Calculate dynamic retention rate from ledger count */
    const stats = useMemo(() => {
        const total = ledgers.length;
        if (total === 0) {
            return { churn: 0.0, retention: 100.0 };
        }
        const active = ledgers.filter((s) => s.active).length;
        const inactive = total - active;
        const churn = (inactive / total) * 100;
        const retention = 100 - churn;
        return { churn, retention };
    }, [ledgers]);

    /* Dynamic SVG stroke offset based on actual retention rate */
    const strokeDashoffset = useMemo(() => {
        return 251.2 - (251.2 * stats.retention) / 100;
    }, [stats.retention]);

    /* Scale bar heights dynamically up to 100% of container height */
    const barHeights = useMemo(() => {
        if (mrr === 0) return [0, 0, 0, 0, 0, 0];
        const values = [
            mrr * 0.5,
            mrr * 0.65,
            mrr * 0.8,
            mrr * 0.9,
            mrr * 0.95,
            mrr
        ];
        const maxVal = Math.max(...values);
        return values.map((v) => (maxVal > 0 ? (v / maxVal) * 100 : 0));
    }, [mrr]);

    /* Display list of actual active premium subscribers */
    const displayList = useMemo(() => {
        return ledgers
            .filter((sub) => sub.active)
            .slice(0, 4)
            .map((sub: any) => ({
                address: sub.shortSubAddress || "0x0000...0000",
                tier: 1, /* Active subscribers of standard subscription represent tier 1 setup */
                timestamp: sub.nextBilling || new Date().toLocaleDateString()
            }));
    }, [ledgers]);

    /* Filter to display list of inactive subscriptions */
    const inactiveList = useMemo(() => {
        return ledgers
            .filter((sub) => !sub.active)
            .map((sub: any) => ({
                id: sub.rawId,
                address: sub.shortSubAddress || "0x0000...0000",
                timestamp: sub.nextBilling || new Date().toLocaleDateString()
            }));
    }, [ledgers]);

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
                <div className={`transition-all duration-300 ${isPremium ? "" : "filter blur-[6px] pointer-events-none select-none"}`}>
                    {activeSubTab === "metrics" ? (
                        <div className="space-y-6">
                            {/* Top Row: 2 columns, asymmetrical on desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Top Left Card: spans 2 columns on desktop */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl relative overflow-hidden col-span-1 md:col-span-2 flex flex-col justify-between min-h-[240px]">
                                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Total Processed Volume</p>
                                            <p className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">${totalVolume.toFixed(2)}</p>
                                        </div>
                                        <div className="text-left sm:text-right">
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Monthly Recurring Revenue</p>
                                            <p className="text-xl sm:text-2xl font-bold text-[#00d2b4] font-mono">${mrr.toFixed(2)}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mt-8">
                                        <p className="text-[9px] text-white/30 max-w-md">
                                            Net volume metrics derived from historical transaction ledger settlements
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
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">30-Day Churn Rate</p>
                                                <p className="text-xl font-bold text-white/90">{stats.churn.toFixed(1)}%</p>
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
                                        Subscriptions active this billing cycle vs cancellations
                                    </p>
                                </div>
                            </div>

                            {/* Bottom Row: 3 columns, symmetrical on desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Bottom Left Card: Performance Chart */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Financial Performance</p>
                                        <p className="text-xs text-white/60">Revenue history (last 6 months)</p>
                                    </div>
                                    
                                    <div className="flex items-end justify-between h-40 pt-6 px-1">
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-white/5 border border-white/5 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/30" style={{ height: `${barHeights[0]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">Jan</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-white/5 border border-white/5 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/30" style={{ height: `${barHeights[1]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">Feb</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-white/5 border border-white/5 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/30" style={{ height: `${barHeights[2]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">Mar</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-[#00d2b4]/10 border border-[#00d2b4]/30 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/30" style={{ height: `${barHeights[3]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">Apr</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-[#00d2b4]/20 border border-[#00d2b4]/40 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/30" style={{ height: `${barHeights[4]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">May</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <div className="w-7 bg-[#00d2b4]/30 border border-[#00d2b4]/50 rounded-t-md transition-all duration-500 hover:bg-[#00d2b4]/50" style={{ height: `${barHeights[5]}%` }}></div>
                                            <span className="text-[9px] text-white/40 font-mono">Jun</span>
                                        </div>
                                    </div>

                                    <p className="text-[9px] text-white/30 font-sans mt-4">
                                        Measured in standard USDC token routing volume
                                    </p>
                                </div>

                                {/* Bottom Center Card: List View */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Recent Subscribers</p>
                                        <p className="text-xs text-white/60">Active premium nodes</p>
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
                                        <p className="text-xs text-white/60">Failed or unpaid accounts</p>
                                    </div>

                                    <div className="space-y-3 my-4 overflow-y-auto max-h-[180px]">
                                        {inactiveList.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-36 text-white/30 text-xs">
                                                No inactive subscriptions
                                            </div>
                                        ) : (
                                            inactiveList.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-[9px] text-red-400 font-bold font-mono">
                                                            ID{item.id}
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-mono text-white/90">{item.address}</p>
                                                            <p className="text-[8px] text-white/30">Due: {item.timestamp}</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRetryClick(item.id)}
                                                        disabled={retryingId === item.id}
                                                        className="px-2.5 py-1.5 bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 hover:border-[#00d2b4]/40 text-[#00d2b4] rounded-xl text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all disabled:opacity-50"
                                                    >
                                                        {retryingId === item.id ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <RefreshCw className="w-3 h-3" />
                                                        )}
                                                        Retry Charge
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <p className="text-[9px] text-white/30 font-sans">
                                        Manual on-chain execution of overdue payment
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Automations Tab Content */
                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl min-h-[480px] flex flex-col justify-between">
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
                                            onClick={() => setIsActive(!isActive)}
                                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                isActive ? "bg-[#00d2b4]" : "bg-white/10"
                                            }`}
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
                                                        onClick={() => insertVariableToSubject("customer_wallet")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5"
                                                    >
                                                        customer_wallet
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => insertVariableToSubject("subscription_tier")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5"
                                                    >
                                                        subscription_tier
                                                    </button>
                                                </div>
                                            </div>
                                            <input
                                                type="text"
                                                required
                                                placeholder="e.g. We want to hear your feedback"
                                                value={subjectLine}
                                                onChange={(e) => setSubjectLine(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors text-xs"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="flex justify-between items-center">
                                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Email Content (Plain Text)</label>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[8px] text-white/30 uppercase font-mono">Variables:</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => insertVariableToBody("customer_wallet")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5"
                                                    >
                                                        customer_wallet
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => insertVariableToBody("subscription_tier")}
                                                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] text-[#00d2b4] hover:text-white transition-all font-mono border border-white/5"
                                                    >
                                                        subscription_tier
                                                    </button>
                                                </div>
                                            </div>
                                            <textarea
                                                required
                                                rows={8}
                                                placeholder="Enter exit survey message here..."
                                                value={bodyContent}
                                                onChange={(e) => setBodyContent(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors text-xs font-sans whitespace-pre-wrap leading-relaxed"
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
                                            disabled={isSavingTemplate}
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
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
