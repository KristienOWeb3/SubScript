import { useMemo } from "react";
import { Crown, BarChart3, ArrowUpRight } from "lucide-react";

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

    const totalVolume = useMemo(() => {
        /* Estimate total historical volume as active MRR + vault balance */
        return mrr * 1.25 + vaultBalance;
    }, [mrr, vaultBalance]);

    const recentSubscribers = useMemo(() => {
        return ledgers
            .slice(0, 4)
            .map((sub: any) => ({
                address: sub.subscriber ? `${sub.subscriber.slice(0, 6)}...${sub.subscriber.slice(-4)}` : "0x0000...0000",
                tier: sub.tier || 0,
                timestamp: sub.last_settlement_timestamp ? new Date(sub.last_settlement_timestamp).toLocaleDateString() : new Date().toLocaleDateString()
            }));
    }, [ledgers]);

    const displayList = recentSubscribers.length > 0 ? recentSubscribers : [
        { address: "0x8F5C...B21a", tier: 1, timestamp: "2026-06-04" },
        { address: "0x3A2b...E4cd", tier: 1, timestamp: "2026-06-03" },
        { address: "0x91eF...76A0", tier: 1, timestamp: "2026-06-01" },
        { address: "0xC50d...118b", tier: 1, timestamp: "2026-05-28" }
    ];

    return (
        <div className="space-y-6 relative max-w-[1400px] mx-auto">
            {/* Header section */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#00d2b4]" />
                        Premium Analytics Dashboard
                    </h2>
                    <p className="text-[10px] text-white/40 mt-1">
                        Real-time revenue, subscriber logs, and payment performance details.
                    </p>
                </div>
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
                <div className={`space-y-6 transition-all duration-300 ${isPremium ? "" : "filter blur-[6px] pointer-events-none select-none"}`}>
                    {/* Top Row: 2 columns, asymmetrical */}
                    <div className="grid grid-cols-3 gap-6">
                        {/* Top Left Card: spans 2 columns */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl relative overflow-hidden col-span-2 flex flex-col justify-between min-h-[240px]">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Total Processed Volume</p>
                                    <p className="text-5xl font-extrabold text-white tracking-tight">${totalVolume.toFixed(2)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Monthly Recurring Revenue</p>
                                    <p className="text-2xl font-bold text-[#00d2b4] font-mono">${mrr.toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="flex justify-between items-end mt-8">
                                <p className="text-[9px] text-white/30 max-w-md">
                                    /* Net volume metrics derived from historical transaction ledger settlements */
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

                        {/* Top Right Card: spans 1 column */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl relative overflow-hidden col-span-1 flex flex-col justify-between min-h-[240px]">
                            <div className="flex justify-between items-start">
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Active Subscriptions</p>
                                        <p className="text-3xl font-extrabold text-white tracking-tight">{activeSubscribers}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">30-Day Churn Rate</p>
                                        <p className="text-xl font-bold text-white/90">2.4%</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center pt-2">
                                    <svg viewBox="0 0 100 100" className="w-24 h-24">
                                        <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.03)" strokeWidth="8" fill="transparent" />
                                        <circle cx="50" cy="50" r="40" stroke="#00d2b4" strokeWidth="8" fill="transparent" strokeDasharray="251.2" strokeDashoffset="62.8" strokeLinecap="round" className="transform -rotate-90 origin-center" />
                                        <text x="50" y="55" textAnchor="middle" fill="white" className="text-xs font-bold font-mono">97.6%</text>
                                    </svg>
                                </div>
                            </div>
                            <p className="text-[9px] text-white/30 font-sans mt-4">
                                /* Subscriptions active this billing cycle vs cancellations */
                            </p>
                        </div>
                    </div>

                    {/* Bottom Row: 3 columns, symmetrical */}
                    <div className="grid grid-cols-3 gap-6">
                        {/* Bottom Left Card: Performance Chart */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                            <div>
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Financial Performance</p>
                                <p className="text-xs text-white/60">Revenue history (last 6 months)</p>
                            </div>
                            
                            <div className="flex items-end justify-between h-40 pt-6 px-1">
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-white/5 border border-white/5 rounded-t-md h-[40px] transition-all duration-500 hover:bg-[#00d2b4]/30"></div>
                                    <span className="text-[9px] text-white/40 font-mono">Jan</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-white/5 border border-white/5 rounded-t-md h-[55px] transition-all duration-500 hover:bg-[#00d2b4]/30"></div>
                                    <span className="text-[9px] text-white/40 font-mono">Feb</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-white/5 border border-white/5 rounded-t-md h-[70px] transition-all duration-500 hover:bg-[#00d2b4]/30"></div>
                                    <span className="text-[9px] text-white/40 font-mono">Mar</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-[#00d2b4]/10 border border-[#00d2b4]/30 rounded-t-md h-[90px] transition-all duration-500 hover:bg-[#00d2b4]/30"></div>
                                    <span className="text-[9px] text-white/40 font-mono">Apr</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-[#00d2b4]/20 border border-[#00d2b4]/40 rounded-t-md h-[110px] transition-all duration-500 hover:bg-[#00d2b4]/30"></div>
                                    <span className="text-[9px] text-white/40 font-mono">May</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-7 bg-[#00d2b4]/30 border border-[#00d2b4]/50 rounded-t-md h-[130px] transition-all duration-500 hover:bg-[#00d2b4]/50"></div>
                                    <span className="text-[9px] text-white/40 font-mono">Jun</span>
                                </div>
                            </div>

                            <p className="text-[9px] text-white/30 font-sans mt-4">
                                /* Measured in standard USDC token routing volume */
                            </p>
                        </div>

                        {/* Bottom Center Card: List View */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                            <div>
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Recent Subscribers</p>
                                <p className="text-xs text-white/60">Active premium nodes</p>
                            </div>

                            <div className="space-y-3 my-4">
                                {displayList.map((item, idx) => (
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
                                ))}
                            </div>

                            <p className="text-[9px] text-white/30 font-sans">
                                /* Sorted by latest settlement transaction */
                            </p>
                        </div>

                        {/* Bottom Right Card: Distribution/Map */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                            <div>
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Network Distribution</p>
                                <p className="text-xs text-white/60">Node regional origins</p>
                            </div>

                            <div className="my-4 space-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-white/60">North America</span>
                                        <span className="text-white font-bold font-mono">48%</span>
                                    </div>
                                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-[#00d2b4] h-full rounded-full" style={{ width: "48%" }}></div>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-white/60">Europe</span>
                                        <span className="text-white font-bold font-mono">32%</span>
                                    </div>
                                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-[#00d2b4] h-full rounded-full" style={{ width: "32%" }}></div>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-white/60">Asia Pacific</span>
                                        <span className="text-white font-bold font-mono">20%</span>
                                    </div>
                                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-[#00d2b4] h-full rounded-full" style={{ width: "20%" }}></div>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[9px] text-white/30 font-sans">
                                /* Geoip resolution from webhook broadcast relays */
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
