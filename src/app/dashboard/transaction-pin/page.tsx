"use client";

import { useEffect, useState } from "react";
import TransactionPinSettings from "@/components/TransactionPinSettings";
import { getDashboardUrl } from "@/utils/navigation";
import TransactionPinSettingsSkeleton from "@/components/TransactionPinSettingsSkeleton";
import { ArrowLeft, KeyRound } from "lucide-react";

export default function TransactionPinPage() {
    const [standalone, setStandalone] = useState(false);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
            .then(async response => {
                const session = await response.json();
                if (!response.ok || typeof session.loggedIn !== "boolean") throw new Error("Session unavailable");
                if (controller.signal.aborted) return;
                if (!session.loggedIn) {
                    window.location.replace(getDashboardUrl("USER", "/signin"));
                } else if (session.role === "USER") {
                    window.location.replace(`${getDashboardUrl("USER", "/dashboard")}?tab=dns&subview=transaction-pin`);
                } else if (session.role === "ENTERPRISE") {
                    setStandalone(true);
                } else {
                    throw new Error("Unsupported account role");
                }
            }).catch(() => { if (!controller.signal.aborted) setError(true); });
        return () => controller.abort();
    }, [refresh]);
    if (standalone) return <TransactionPinSettings />;
    return <main className="transaction-pin-settings min-h-screen bg-[#FFFFF0] px-4 py-10 text-[#082824] dark:bg-[#060608] dark:text-white">
        {error ? <div className="space-y-3 text-center"><p role="alert">Unable to open PIN settings. Please retry.</p><button type="button" className="rounded-xl bg-[#2775CA] px-4 py-2 font-semibold text-white" onClick={() => { setError(false); setRefresh(value => value + 1); }}>Retry</button></div> : <section className="mx-auto w-full max-w-lg rounded-[2rem] border border-[#082824]/10 bg-white/60 p-5 shadow-[0_12px_48px_rgba(8,40,36,0.045)] sm:p-8 dark:border-white/10 dark:bg-white/[0.03]">
            <a href="/dashboard-router" className="inline-flex items-center gap-2 text-xs font-semibold text-[#2775CA]"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Back to dashboard</a>
            <div className="mt-6 flex items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D3E3E8]/60 text-[#082824] dark:bg-white/10 dark:text-white"><KeyRound aria-hidden="true" className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#082824]/50 dark:text-white/50">Wallet security</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Transaction PIN</h1></div></div>
            <p className="mt-4 text-sm leading-relaxed text-[#082824]/65 dark:text-white/65">Protect payments from your SubScript wallet with a private six-digit PIN. Verify your email whenever you set, change, or reset it.</p>
            <TransactionPinSettingsSkeleton />
        </section>}
    </main>;
}
