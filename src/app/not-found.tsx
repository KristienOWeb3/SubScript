import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Page not found",
    robots: { index: false, follow: false },
};

/* Branded 404. Renders inside the root layout, so it inherits the global fonts/providers and
   matches the rest of the app (black canvas, lime accent, Instrument Serif display). */
export default function NotFound() {
    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-6 text-white">
            {/* Ambient brand glow */}
            <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-[120px]"
                style={{ background: "radial-gradient(circle, #ccff00 0%, transparent 70%)" }}
            />

            <div className="relative z-10 w-full max-w-md text-center">
                <p
                    className="select-none text-[120px] font-bold italic leading-none tracking-tighter text-white/90 sm:text-[160px]"
                    style={{ fontFamily: "var(--font-instrument)" }}
                >
                    404
                </p>

                <h1 className="mt-2 text-xl font-black tracking-tight">This page took a different route</h1>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/50">
                    The link may be broken, expired, or the resource was moved. Your account and balances
                    are unaffected.
                </p>

                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link
                        href="/"
                        className="w-full rounded-xl bg-[#ccff00] px-5 py-3 text-xs font-black uppercase tracking-wider text-black transition hover:brightness-110 sm:w-auto"
                    >
                        Back to home
                    </Link>
                    <Link
                        href="/dashboard-router"
                        className="w-full rounded-xl border border-white/10 px-5 py-3 text-xs font-bold uppercase tracking-wider text-white/70 transition hover:bg-white/5 hover:text-white sm:w-auto"
                    >
                        Go to dashboard
                    </Link>
                </div>

                <div className="mt-10 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/30">
                    <span className="h-1 w-1 rounded-full bg-[#ccff00]" />
                    SubScript
                </div>
            </div>
        </main>
    );
}
