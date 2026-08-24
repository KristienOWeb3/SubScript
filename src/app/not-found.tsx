import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Compass, Home, HelpCircle, Shield } from "lucide-react";

export const metadata: Metadata = {
    title: "Page Not Found | SubScript",
    description: "The requested resource could not be found on SubScript.",
    robots: { index: false, follow: false },
};

export default function NotFound() {
    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#06080d] px-6 text-white selection:bg-[#2775ca] selection:text-white">
            {/* Ambient Background Glows */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-[140px]"
                style={{ background: "radial-gradient(circle, #2775ca 0%, rgba(39,117,202,0.15) 50%, transparent 80%)" }}
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute right-10 bottom-10 h-[300px] w-[300px] rounded-full opacity-15 blur-[120px]"
                style={{ background: "radial-gradient(circle, #38bdf8 0%, transparent 70%)" }}
            />

            {/* Subtle Grid Background Pattern */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="relative z-10 w-full max-w-lg text-center">
                {/* Protocol Badge */}
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 backdrop-blur-md mb-6 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                    <span className="flex h-2 w-2 rounded-full bg-[#2775ca] animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
                        Error 404 • Arc Network
                    </span>
                </div>

                {/* Big 404 Display */}
                <div className="relative my-2 select-none">
                    <span
                        className="text-[120px] font-black italic leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-white/80 to-white/20 sm:text-[160px]"
                    >
                        404
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center opacity-10 blur-sm pointer-events-none">
                        <span className="text-[120px] font-black italic text-[#2775ca] sm:text-[160px]">
                            404
                        </span>
                    </div>
                </div>

                {/* Heading and Description */}
                <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    This route is uncharted
                </h1>
                <p className="mx-auto mt-3 max-w-md text-xs sm:text-sm leading-relaxed text-slate-400">
                    The requested URL does not exist or has been moved. Your wallet, escrow balances, and active subscriptions remain completely secure and unaffected.
                </p>

                {/* Action Buttons */}
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link
                        href="/"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2775ca] px-6 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-[0_4px_20px_rgba(39,117,202,0.35)] transition-all hover:bg-[#1d61a8] hover:shadow-[0_6px_24px_rgba(39,117,202,0.5)] active:scale-[0.98] sm:w-auto"
                    >
                        <Home className="h-4 w-4" />
                        <span>Return Home</span>
                    </Link>

                    <Link
                        href="/dashboard-router"
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-xs font-bold uppercase tracking-wider text-white/90 backdrop-blur-md transition-all hover:bg-white/10 hover:border-white/25 active:scale-[0.98] sm:w-auto"
                    >
                        <Compass className="h-4 w-4 text-[#2775ca]" />
                        <span>Open Dashboard</span>
                    </Link>
                </div>

                {/* Quick Assistance Footer */}
                <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-[#2775ca]" />
                        <span className="font-semibold text-slate-400">SubScript Protocol</span>
                    </div>
                    <Link
                        href="/support"
                        className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
                    >
                        <HelpCircle className="h-3.5 w-3.5" />
                        <span>Help & Support</span>
                    </Link>
                </div>
            </div>
        </main>
    );
}
