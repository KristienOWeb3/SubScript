import { useMemo } from "react";
import { TrendingUp, Users, Layers, DollarSign, Crown, BarChart3, ArrowUpRight, ShieldAlert } from "lucide-react";

interface AnalyticsDashboardProps {
    isPremium: boolean;
    setActiveTab: (tab: any) => void;
    walletBalance: number;
    vaultBalance: number;
    ledgers: any[];
}

export default function AnalyticsDashboard({
    isPremium,
    setActiveTab,
    walletBalance,
    vaultBalance,
    ledgers,
}: AnalyticsDashboardProps) {
    /* Compute metrics based on active subscriptions in ledger */
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

    const activePlans = useMemo(() => {
        const uniquePlans = new Set(
            ledgers.filter((sub) => sub.active).map((sub) => sub.rawPeriod)
        );
        return uniquePlans.size || 1;
    }, [ledgers]);

    const totalVolume = useMemo(() => {
        /* Estimate total historical volume as active MRR + vault balance */
        return mrr * 1.25 + vaultBalance;
    }, [mrr, vaultBalance]);

    return (
        <div className="space-y-8 relative">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#00d2b4]" />
                        Analytics Insights
                    </h2>
                    <p className="text-[10px] text-white/40 mt-1">
                        Real-time revenue, subscriber logs, and payment performance details.
                    </p>
                </div>
            </div>

            {/* Container wrapper for blur control */}
            <div className="relative rounded-3xl overflow-hidden min-h-[400px]">
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

                {/* Dashboard stats layout */}
                <div className={`space-y-8 transition-all duration-300 ${isPremium ? "" : "filter blur-[6px] pointer-events-none select-none"}`}>
                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                        {/* Monthly Recurring Revenue */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Monthly Recurring Revenue</p>
                            <p className="text-3xl font-extrabold text-[#00d2b4] mb-1 tracking-tight">
                                ${mrr.toFixed(2)}
                            </p>
                            <p className="text-[10px] text-white/30 flex items-center gap-1">
                                <TrendingUp className="w-3 h-3 text-[#00d2b4]" /> MRR from active subscriptions
                            </p>
                        </div>

                        {/* Active Subscribers */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Active Subscribers</p>
                            <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                {activeSubscribers}
                            </p>
                            <p className="text-[10px] text-white/30 flex items-center gap-1">
                                <Users className="w-3 h-3 text-[#00d2b4]" /> Active paying consumer nodes
                            </p>
                        </div>

                        {/* Active Plans */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Active Billing Plans</p>
                            <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                {activePlans}
                            </p>
                            <p className="text-[10px] text-white/30 flex items-center gap-1">
                                <Layers className="w-3 h-3 text-[#00d2b4]" /> Unique subscription intervals
                            </p>
                        </div>

                        {/* Total Volume */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Total Value Routed</p>
                            <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                ${totalVolume.toFixed(2)}
                            </p>
                            <p className="text-[10px] text-white/30 flex items-center gap-1">
                                <DollarSign className="w-3 h-3 text-[#00d2b4]" /> Estimated lifetime payout volume
                            </p>
                        </div>
                    </div>

                    {/* Customer Distribution list wrapper */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                            Revenue Performance Breakdown
                        </h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center text-xs border-b border-white/5 pb-2">
                                <span className="text-white/60">Estimated Annual Run Rate (ARR)</span>
                                <span className="font-extrabold text-white font-mono">${(mrr * 12).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs border-b border-white/5 pb-2">
                                <span className="text-white/60">Average Revenue Per User (ARPU)</span>
                                <span className="font-extrabold text-white font-mono">
                                    ${activeSubscribers > 0 ? (mrr / activeSubscribers).toFixed(2) : "0.00"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs border-b border-white/5 pb-2">
                                <span className="text-white/60">Current Unsettled Vault Balance</span>
                                <span className="font-extrabold text-[#00d2b4] font-mono">${vaultBalance.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-white/60">Wallet Reserves</span>
                                <span className="font-extrabold text-white font-mono">${walletBalance.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
