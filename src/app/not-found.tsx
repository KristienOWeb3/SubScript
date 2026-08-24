import type { Metadata } from "next";
import Link from "next/link";
import { Compass, Home, HelpCircle, Shield } from "lucide-react";

export const metadata: Metadata = {
    title: "Page Not Found | SubScript",
    description: "The requested resource could not be found on SubScript.",
    robots: { index: false, follow: false },
};

export default function NotFound() {
    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#F8F9FA] px-4 py-12 text-slate-900 font-sans selection:bg-[#2775CA]/20 selection:text-slate-900">
            {/* Ambient Background Accents */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/4 h-[450px] w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[130px]"
                style={{ background: "radial-gradient(circle, rgba(39,117,202,0.18) 0%, rgba(39,117,202,0.05) 50%, transparent 80%)" }}
            />

            <div className="relative z-10 w-full max-w-lg">
                <div className="rounded-3xl border border-black/10 bg-white/90 p-8 sm:p-12 text-center shadow-sm backdrop-blur-md space-y-6">
                    {/* Big 404 Display */}
                    <div className="select-none py-2">
                        <span className="text-7xl sm:text-9xl font-black italic tracking-tighter text-[#2775CA]">
                            404
                        </span>
                    </div>

                    {/* Heading and Description */}
                    <div className="space-y-2">
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                            Page Not Found
                        </h1>
                        <p className="mx-auto max-w-sm text-xs sm:text-sm leading-relaxed text-slate-500">
                            The page you are looking for does not exist or has been moved. Your wallet balances and subscriptions remain safe and unaffected.
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link
                            href="/"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-[#2775CA] px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm hover:bg-[#1d61a8] active:scale-[0.98] transition-all"
                        >
                            <Home className="h-4 w-4" />
                            <span>Return Home</span>
                        </Link>

                        <Link
                            href="/dashboard-router"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-800 hover:bg-black/5 hover:border-black/20 active:scale-[0.98] transition-all shadow-sm"
                        >
                            <Compass className="h-4 w-4 text-[#2775CA]" />
                            <span>Open Dashboard</span>
                        </Link>
                    </div>

                    {/* Card Footer */}
                    <div className="pt-6 border-t border-black/10 flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-500">
                            <Shield className="h-3.5 w-3.5 text-[#2775CA]" />
                            <span>SubScript</span>
                        </div>
                        <Link
                            href="/support"
                            className="flex items-center gap-1 text-slate-500 hover:text-[#2775CA] transition-colors font-medium"
                        >
                            <HelpCircle className="h-3.5 w-3.5" />
                            <span>Help & Support</span>
                        </Link>
                    </div>
                </div>
            </div>
        </main>
    );
}
