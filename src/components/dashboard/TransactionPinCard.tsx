"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { readTransactionPinStatus, type TransactionPinStatus } from "@/lib/client/transactionPin";

export default function TransactionPinCard({ onManage }: { onManage?: () => void } = {}) {
    const [status, setStatus] = useState<TransactionPinStatus | null>(null);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/user/transaction-pin", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
            .then(readTransactionPinStatus)
            .then(value => { if (!controller.signal.aborted) { setStatus(value); setNow(Date.now()); } })
            .catch(() => { if (!controller.signal.aborted) setError("PIN status unavailable. Please retry."); });
        const reload = () => { setStatus(null); setError(""); setRefresh(value => value + 1); };
        window.addEventListener("focus", reload);
        const timer = window.setInterval(reload, 60_000);
        return () => { controller.abort(); window.removeEventListener("focus", reload); window.clearInterval(timer); };
    }, [refresh]);
    const recovering = Boolean(status?.coolingOffUntil && Date.parse(status.coolingOffUntil) > now);
    const locked = Boolean(status?.lockedUntil && Date.parse(status.lockedUntil) > now);
    const required = status?.required !== false;
    const label = error ? "Unavailable" : !status ? "Checking…" : !required ? "Wallet approvals" : recovering ? "Recovery hold" : locked ? "Locked" : status.configured ? "Active" : "Not set up";
    const active = required && status?.configured && !recovering && !locked;
    return <section aria-label="Transaction PIN" className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#2775CA]" /> Transaction PIN</h3>
                <p role="status" className={`inline-block rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700" : "border-black/15 bg-black/5 text-black/60"}`}>{label}</p>
                <p className="max-w-md text-xs text-black/50 leading-relaxed">{required ? "Your private six-digit PIN protects outgoing payments and spending permissions from your SubScript wallet." : "External wallets do not need a transaction PIN. Approve outgoing payments in your connected wallet."}</p>
            </div>
            {required && <a href="/dashboard/transaction-pin" onClick={onManage ? event => { event.preventDefault(); onManage(); } : undefined} className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-[#2775CA] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#1f63ab] transition-colors self-start sm:self-auto">{status && !status.configured ? "Set up PIN" : "Manage PIN"}</a>}
        </div>
        {error && <div className="flex items-center justify-between gap-3"><p role="alert" className="text-xs text-black/60">{error}</p><button type="button" onClick={() => { setStatus(null); setError(""); setRefresh(value => value + 1); }} className="text-xs font-bold text-[#2775CA]">Retry</button></div>}
        {recovering && <p className="text-xs text-black/60">Outbound transactions are held until {new Date(status!.coolingOffUntil!).toLocaleString()} after PIN recovery.</p>}
        {locked && <p className="text-xs text-black/60">PIN attempts are locked until {new Date(status!.lockedUntil!).toLocaleString()}.</p>}
    </section>;
}
