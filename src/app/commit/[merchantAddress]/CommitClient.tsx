"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, Zap, MessageSquare, RefreshCw
} from "@/components/icons";

type MerchantInfo = {
    address: string;
    name: string;
    alias: string | null;
    verified: boolean;
    tier: string;
};

type SessionInfo = {
    loggedIn: boolean;
    wallet?: string;
    email?: string | null;
    role?: string | null;
    isEmbedded?: boolean;
};

export default function CommitClient({
    merchantAddress,
    initialMerchant,
    initialAmount,
    successUrl,
    cancelUrl,
}: {
    merchantAddress: string;
    initialMerchant: MerchantInfo | null;
    initialAmount: string;
    successUrl?: string;
    cancelUrl?: string;
}) {
    const router = useRouter();

    const [merchant] = useState<MerchantInfo | null>(initialMerchant);
    const amountUsdc = "2.00"; // Fixed Platform Standard Commit
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [isCommitting, setIsCommitting] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    const [commitPendingNote, setCommitPendingNote] = useState<string | null>(null);
    const [committedTxHash, setCommittedTxHash] = useState<string | null>(null);
    const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);

    const commitRequestKey = useRef<string | null>(null);
    const commitInFlight = useRef(false);

    const commitStorageKey = `subscript:vault-commit:${merchantAddress.toLowerCase()}`;

    const readStoredRequestId = () => {
        try {
            return window.localStorage.getItem(commitStorageKey);
        } catch {
            return null;
        }
    };

    const writeStoredRequestId = (id: string | null) => {
        try {
            if (id) window.localStorage.setItem(commitStorageKey, id);
            else window.localStorage.removeItem(commitStorageKey);
        } catch {
            /* ignore */
        }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            const res = await fetch("/api/auth/session");
            const data = await res.json().catch(() => null);
            if (data) setSession(data);
            router.refresh();
        } catch (err) {
            console.error("[CommitClient] refresh error:", err);
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        fetch("/api/auth/session")
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setSession(data); })
            .catch(() => { if (!cancelled) setSession({ loggedIn: false }); })
            .finally(() => { if (!cancelled) setSessionLoaded(true); });
        return () => { cancelled = true; };
    }, []);

    const resolveCommitIntent = async (requestId: string) => {
        try {
            const res = await fetch(`/api/user/vault/commit?requestId=${encodeURIComponent(requestId)}`);
            if (!res.ok) return null;
            return await res.json().catch(() => null);
        } catch {
            return null;
        }
    };

    const pollCommitIntent = async (requestId: string) => {
        const delaysMs = [0, 1500, 3000, 5000];
        let latest: any = null;
        for (const delay of delaysMs) {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            latest = await resolveCommitIntent(requestId);
            if (latest?.exists && (latest.status === "MIRRORED" || latest.status === "FAILED")) return latest;
        }
        return latest;
    };

    const applyCommitOutcome = (outcome: any): boolean => {
        if (outcome?.exists && outcome.status === "MIRRORED" && outcome.txHash) {
            setCommitError(null);
            setCommitPendingNote(null);
            setCommittedTxHash(outcome.txHash);
            commitRequestKey.current = null;
            writeStoredRequestId(null);
            return true;
        }
        if (outcome?.exists && outcome.status === "FAILED") {
            setCommitPendingNote(null);
            setCommitError(outcome.lastError || "That commit stopped before any funds moved. You can start a new one.");
            commitRequestKey.current = null;
            writeStoredRequestId(null);
            return true;
        }
        return false;
    };

    useEffect(() => {
        const stored = readStoredRequestId();
        if (!stored) return;
        commitRequestKey.current = stored;
        let cancelled = false;
        (async () => {
            const outcome = await pollCommitIntent(stored);
            if (cancelled) return;
            if (applyCommitOutcome(outcome)) return;
            if (outcome?.exists) {
                setCommitPendingNote("You have a commit to this merchant still being confirmed. Trying again resumes it rather than escrowing twice.");
            } else {
                commitRequestKey.current = null;
                writeStoredRequestId(null);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const handleSignIn = () => {
        const next = `/commit/${merchantAddress}?amount=${encodeURIComponent(amountUsdc)}`;
        router.push(`/signin?next=${encodeURIComponent(next)}`);
    };

    const handleCommit = async () => {
        if (isCommitting || commitInFlight.current) return;
        commitInFlight.current = true;
        setIsCommitting(true);
        setCommitError(null);
        setCommitPendingNote(null);

        commitRequestKey.current ||= crypto.randomUUID();
        const requestId = commitRequestKey.current;
        writeStoredRequestId(requestId);

        try {
            let res: Response;
            try {
                res = await fetch("/api/user/vault/commit", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-request-id": requestId,
                    },
                    body: JSON.stringify({
                        merchantAddress,
                        amountUsdc,
                        acknowledgeUnverified: acknowledgedUnverified || undefined,
                    }),
                });
            } catch {
                try {
                    res = await fetch("/api/user/vault/commit", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-request-id": requestId,
                        },
                        body: JSON.stringify({
                            merchantAddress,
                            amountUsdc,
                            acknowledgeUnverified: acknowledgedUnverified || undefined,
                        }),
                    });
                } catch {
                    const outcome = await pollCommitIntent(requestId);
                    if (!applyCommitOutcome(outcome)) {
                        setCommitPendingNote("The connection dropped before the network confirmed this commit. Your money is safe. Try again to resume confirmation.");
                    }
                    return;
                }
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                if (data.code === "UNVERIFIED_MERCHANT") {
                    setAcknowledgedUnverified(true);
                    throw new Error(data.error || "Please review and confirm committing to an unverified merchant.");
                }
                if (data.code === "COMMIT_AMBIGUOUS") {
                    const outcome = await pollCommitIntent(requestId);
                    if (!applyCommitOutcome(outcome)) {
                        setCommitPendingNote("This commit is still being confirmed on the network. Try again in a moment to resume.");
                    }
                    return;
                }
                if (data.code === "REQUEST_ID_CONFLICT" || data.code === "COMMIT_FAILED") {
                    commitRequestKey.current = null;
                    writeStoredRequestId(null);
                }
                throw new Error(data.error || "Vault commitment failed.");
            }
            commitRequestKey.current = null;
            writeStoredRequestId(null);
            setCommittedTxHash(data.txHash || "confirmed");
        } catch (err: any) {
            setCommitError(err.message || "Failed to commit funds.");
        } finally {
            commitInFlight.current = false;
            setIsCommitting(false);
        }
    };

    const isEnterpriseViewer = session?.role === "ENTERPRISE";

    return (
        <div className="min-h-screen bg-[#FFFFF0] text-[#082824] flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <div className="relative z-10 w-full max-w-lg my-auto">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-black tracking-tight text-[#082824]">
                        SubScript <span className="font-serif italic font-normal text-[#2775CA]">Vault Commit</span>
                    </h1>
                    <p className="text-xs text-black/50 mt-1">Pay-as-you-go Metered Escrow</p>
                </div>

                <div className="rounded-[32px] border border-black/10 bg-white p-6 sm:p-8 shadow-xl space-y-6 relative overflow-hidden">
                    {/* Merchant Identity Pill */}
                    <div className="flex items-center gap-3 rounded-2xl bg-[#D4E3E8]/40 border border-black/5 p-3.5">
                        <div className="h-10 w-10 rounded-full bg-[#082824] flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0">
                            {(merchant?.name || "M").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider">Merchant</p>
                            <p className="truncate font-mono text-sm font-bold text-[#082824]">
                                {merchant?.name || `${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-4)}`}
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {merchant?.verified ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-[10px] font-bold text-emerald-900">
                                    <Shield className="w-3 h-3" /> Verified
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
                                    <AlertTriangle className="w-3 h-3" /> Unverified
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                title="Refresh session"
                                className="p-1 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#2775CA]" : ""}`} />
                            </button>
                        </div>
                    </div>

                    {/* Amount Banner */}
                    <div className="rounded-2xl border border-black/10 bg-[#D4E3E8] p-5 flex justify-between items-center">
                        <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#082824]/60 flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-[#2775CA]" /> Initial Escrow
                            </span>
                            <p className="text-xs text-[#082824]/70 mt-0.5">Metered billing balance</p>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-black text-[#082824] tracking-tight">{amountUsdc} USDC</p>
                            <p className="text-[9px] text-black/50 uppercase font-bold tracking-wider">
                                Arc Mainnet
                            </p>
                        </div>
                    </div>

                    <p className="text-xs text-black/60 leading-relaxed">
                        Committing escrows <strong className="text-[#082824]">{amountUsdc} USDC</strong> into your smart vault for this merchant. The merchant bills metered usage against this balance as you use services. You can adjust, top up, or withdraw funds anytime in your User Dashboard.
                    </p>

                    {committedTxHash ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                            <CheckCircle className="w-8 h-8 text-emerald-600" />
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-emerald-950">Vault Committed Successfully</p>
                                <p className="text-xs text-emerald-800 leading-relaxed">
                                    Your Pay-As-You-Go commitment of {amountUsdc} USDC to {merchant?.name || "the merchant"} is now active.
                                </p>
                            </div>

                            <div className="w-full pt-2 space-y-2">
                                <button
                                    type="button"
                                    onClick={() => router.push(`/user?tab=inbox&peer=${encodeURIComponent(merchantAddress)}`)}
                                    className="w-full py-3.5 bg-[#082824] hover:bg-[#0c3933] text-white font-bold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
                                >
                                    <MessageSquare className="w-4 h-4" /> Go to SubScript Dashboard <ArrowRight className="w-4 h-4" />
                                </button>
                                {successUrl && (
                                    <a
                                        href={successUrl}
                                        className="block text-center text-xs font-bold text-black/50 hover:text-black transition pt-1"
                                    >
                                        Return to Merchant App
                                    </a>
                                )}
                            </div>
                        </div>
                    ) : !sessionLoaded ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-[#2775CA]" />
                        </div>
                    ) : isEnterpriseViewer ? (
                        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-red-900">
                            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <p className="text-xs leading-relaxed">
                                You are signed in with an <strong className="font-bold">Enterprise Merchant</strong> account. Please switch to a user account to commit vault funds.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {commitPendingNote && (
                                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-left">
                                    <span className="text-amber-900 text-xs font-bold uppercase tracking-wide block">Confirmation In Progress</span>
                                    <p className="text-amber-800 text-xs mt-1 leading-relaxed">{commitPendingNote}</p>
                                </div>
                            )}

                            {commitError && (
                                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-left">
                                    <span className="text-red-900 text-xs font-bold uppercase tracking-wide block">Commitment Failed</span>
                                    <p className="text-red-800 text-xs font-mono mt-1 leading-normal break-words">{commitError}</p>
                                </div>
                            )}

                            {acknowledgedUnverified && (
                                <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl text-left space-y-2">
                                    <span className="text-amber-900 text-xs font-bold flex items-center gap-1.5">
                                        <AlertTriangle className="w-4 h-4 text-amber-600" /> Unverified Merchant Notice
                                    </span>
                                    <p className="text-xs text-amber-800 leading-relaxed">
                                        This merchant is not yet verified on SubScript. Only commit funds if you trust this business.
                                    </p>
                                </div>
                            )}

                            {session?.loggedIn ? (
                                <button
                                    type="button"
                                    onClick={handleCommit}
                                    disabled={isCommitting}
                                    className="w-full py-3.5 bg-[#082824] hover:bg-[#0c3933] disabled:opacity-50 text-white font-bold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
                                >
                                    {isCommitting ? (
                                        <><Loader2 className="w-4 h-4 animate-spin text-white" /> Committing to vault…</>
                                    ) : (
                                        <>Authorize {amountUsdc} USDC Commit <ArrowRight className="w-4 h-4" /></>
                                    )}
                                </button>
                            ) : (
                                <>
                                    <p className="text-xs text-black/50 text-center leading-relaxed">
                                        Sign in or create your SubScript wallet to start this service.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSignIn}
                                        className="w-full py-3.5 bg-[#2775CA] hover:bg-[#1f62ab] text-white font-bold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
                                    >
                                        Sign in to commit <ArrowRight className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    <div className="pt-2 flex items-center justify-center gap-1.5 text-[10px] text-black/40 font-medium">
                        <Lock className="w-3.5 h-3.5" /> Secured by SubScript Server-Signed Embedded Vault
                    </div>
                </div>
            </div>
        </div>
    );
}
