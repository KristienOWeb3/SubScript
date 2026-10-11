"use client";

import { useEffect, useState } from "react";
import TransactionPinSettings from "@/components/TransactionPinSettings";
import { getDashboardUrl } from "@/utils/navigation";

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
    return <main className="flex min-h-screen items-center justify-center bg-[#FFFFF0] px-4 text-[#082824] dark:bg-[#060608] dark:text-white">
        {error ? <div className="space-y-3 text-center"><p role="alert">Unable to open PIN settings. Please retry.</p><button type="button" className="rounded-xl bg-[#2775CA] px-4 py-2 font-semibold text-white" onClick={() => { setError(false); setRefresh(value => value + 1); }}>Retry</button></div> : <p role="status">Opening PIN settings…</p>}
    </main>;
}
