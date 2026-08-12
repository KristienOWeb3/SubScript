"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, Zap, MessageSquare, RefreshCw
} from "@/components/icons";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

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
    const amountUsdc = "2.00"; // Fixed 2.00 Platform Commit Price (STANDARD_COMMIT_MICROS = 2000000)
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [isCommitting, setIsCommitting] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    /* Deliberately separate from commitError: "submitted, outcome unknown" is not a failure, and
       rendering it as one is what made a commit that actually landed look broken. */
    const [commitPendingNote, setCommitPendingNote] = useState<string | null>(null);
    const [committedTxHash, setCommittedTxHash] = useState<string | null>(null);
    const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);

    const commitRequestKey = useRef<string | null>(null);
    const commitInFlight = useRef(false);

    /* The request id has to outlive this component. POST /api/user/vault/commit escrows funds and
       dedupes strictly on x-request-id, so a reload that mints a fresh id escrows a SECOND time
       for the same intent. The route's GET resolver was written for exactly this and documents an
       id held in localStorage — which a ref alone never provided. Keyed per merchant; the amount
       is fixed, so there is only ever one open commit per merchant. */
    const commitStorageKey = `subscript:vault-commit:${merchantAddress.toLowerCase()}`;

    const readStoredRequestId = () => {
        try {
            return window.localStorage.getItem(commitStorageKey);
        } catch {
            /* Storage can throw outright in private modes. Losing resume is survivable; failing
               the commit because we could not write a bookkeeping key is not. */
            return null;
        }
    };

    const writeStoredRequestId = (id: string | null) => {
        try {
            if (id) window.localStorage.setItem(commitStorageKey, id);
            else window.localStorage.removeItem(commitStorageKey);
        } catch {
            /* See readStoredRequestId. */
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

    /* Ask the server what became of a commit whose response we never read. Returns the resolver
       payload, or null when the lookup itself fails. */
    const resolveCommitIntent = async (requestId: string) => {
        try {
            const res = await fetch(`/api/user/vault/commit?requestId=${encodeURIComponent(requestId)}`);
            if (!res.ok) return null;
            return await res.json().catch(() => null);
        } catch {
            return null;
        }
    };

    /* MIRRORED is the only terminal success and it is written after the mirror sync that follows
       submission, so a commit that landed legitimately sits at SUBMITTED for a moment. Poll with
       backoff instead of reading the status once and calling an in-flight commit unresolved. */
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

    /* Project a resolver payload onto the UI. Returns true when the outcome was terminal, so the
       caller knows whether the request id still needs to be kept for a resuming retry. */
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
            /* FAILED is terminal server-side — the route rejects this id from here on, so a retry
               has to be a new operation. */
            commitRequestKey.current = null;
            writeStoredRequestId(null);
            return true;
        }
        return false;
    };

    /* Resume an unresolved commit from an earlier page view. Whatever this finds outranks anything
       the page would otherwise let the user do: offering a fresh commit while one is still open
       would escrow twice for a single intent. */
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
                /* No intent under this id, so nothing was ever submitted. Drop it rather than
                   carrying a dead id into the next attempt. */
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

        /* Minted once, reused by every retry, and written to storage BEFORE the request leaves:
           an id that exists only in memory cannot resolve an attempt whose response never came. */
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
                /* Transient connection glitch or cold-start timeout ("Failed to fetch"). Retry once immediately with the same request ID before polling. */
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
                        setCommitPendingNote("The connection dropped before the network confirmed this commit, so we can't tell you yet whether it went through. Your money is safe either way. Try again and we'll pick up the same commit rather than escrow a second time.");
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
                /* The server submitted and could not confirm. Same handling as a dropped
                   connection: resolve it, and keep the id so a retry resumes rather than duplicates. */
                if (data.code === "COMMIT_AMBIGUOUS") {
                    const outcome = await pollCommitIntent(requestId);
                    if (!applyCommitOutcome(outcome)) {
                        setCommitPendingNote("This commit is still being confirmed on the network. Try again in a moment and we'll pick up the same commit rather than escrow a second time.");
                    }
                    return;
                }
                if (data.code === "REQUEST_ID_CONFLICT" || data.code === "COMMIT_FAILED") {
                    /* Both are terminal for this id: the route will keep rejecting it, so the next
                       attempt has to start a new operation. */
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
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4] flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <AnimatedGradientBg />

            <div className="relative z-10 w-full max-w-xl my-auto">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">commit</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Pay as you go</p>
                </div>

                <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 max-h-[85vh] overflow-y-auto">

                    {/* Merchant Identity */}
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center text-[#00d2b4] font-black uppercase">
                            {(merchant?.name || "M").slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Pay-As-You-Go Service</p>
                            <p className="truncate font-mono text-sm font-bold text-white">{merchant?.name || merchantAddress.slice(0, 8)}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            {merchant?.verified ? (
                                <div className="flex items-center gap-1 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg px-2 py-1">
                                    <Shield className="w-3 h-3 text-emerald-400" />
                                    <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">Verified</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-2 py-1">
                                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                                    <span className="text-[8px] font-bold text-amber-400 uppercase tracking-wider">Unverified</span>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                title="Refresh Session & State"
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#00d2b4]" : ""}`} />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Commitment Amount</span>
                        <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex justify-between items-center">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-[#00d2b4]" /> Metered Escrow
                            </span>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-[#00d2b4] tracking-tight">{amountUsdc} USDC</p>
                                <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest font-mono">
                                    Drawn on reported usage
                                </p>
                            </div>
                        </div>
                    </div>

                    <p className="text-[10px] text-white/45 leading-relaxed">
                        Committing escrows <span className="text-white/70 font-bold">{amountUsdc} USDC</span> into your vault for this merchant.
                        The merchant can bill metered usage against this balance as services are delivered. You can adjust, top up, or pause your service anytime from your SubScript User Dashboard.
                    </p>

                    {committedTxHash ? (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-white">Vault committed</p>
                                <p className="text-xs text-white/60 leading-relaxed">
                                    Your Pay-As-You-Go commitment of {amountUsdc} USDC to {merchant?.name || "the merchant"} is active.
                                </p>
                            </div>

                            <div className="w-full pt-2 space-y-2">
                                <button
                                    type="button"
                                    onClick={() => router.push(`/user?tab=inbox&peer=${encodeURIComponent(merchantAddress)}`)}
                                    className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-[#00d2b4] hover:brightness-110 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                >
                                    <MessageSquare className="w-4 h-4" /> Go to SubScript Dashboard (User DM) <ArrowRight className="w-4 h-4" />
                                </button>
                                {successUrl && (
                                    <a
                                        href={successUrl}
                                        className="block text-center text-[11px] font-bold text-white/40 hover:text-white/80 transition pt-1"
                                    >
                                        Return to Merchant App
                                    </a>
                                )}
                            </div>
                        </div>
                    ) : !sessionLoaded ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-5 h-5 animate-spin text-[#00d2b4]" />
                        </div>
                    ) : isEnterpriseViewer ? (
                        <div className="bg-red-500/[0.06] border border-red-500/25 rounded-2xl p-4 flex items-start gap-3">
                            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-white/60 leading-relaxed">
                                You&apos;re signed in as a <span className="font-bold text-red-300">merchant</span> account. Only user accounts can commit to metered vaults.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {commitPendingNote && (
                                <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl text-left">
                                    <span className="text-amber-300 text-[9px] font-bold uppercase tracking-wide block">Still confirming</span>
                                    <p className="text-amber-100/70 text-[10px] mt-1 leading-relaxed">{commitPendingNote}</p>
                                </div>
                            )}

                            {commitError && (
                                <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl text-left">
                                    <span className="text-red-400 text-[9px] font-bold uppercase tracking-wide block">Commitment Failed</span>
                                    <p className="text-red-200/70 text-[10px] font-mono mt-1 leading-normal break-words">{commitError}</p>
                                </div>
                            )}

                            {acknowledgedUnverified && (
                                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-left space-y-2">
                                    <span className="text-amber-300 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                                        <AlertTriangle className="w-4 h-4 text-amber-400" /> Unverified Merchant Warning
                                    </span>
                                    <p className="text-[10px] text-white/70 leading-relaxed">
                                        This merchant has not been verified by SubScript. Only commit funds if you trust this merchant.
                                    </p>
                                </div>
                            )}

                            {session?.loggedIn ? (
                                <button
                                    type="button"
                                    onClick={handleCommit}
                                    disabled={isCommitting}
                                    className="w-full py-4 bg-gradient-to-r from-[#00d2b4] to-blue-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                >
                                    {isCommitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Committing to vault…</>
                                        : <>Authorize {amountUsdc} USDC Commit <ArrowRight className="w-4 h-4" /></>}
                                </button>
                            ) : (
                                <>
                                    <p className="text-[10px] text-white/40 text-center leading-relaxed">
                                        Sign in or create a SubScript account to start your Pay-As-You-Go service.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSignIn}
                                        className="w-full py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                    >
                                        Sign in to commit <ArrowRight className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    <div className="pt-2 flex items-center justify-center gap-1.5 text-[9px] text-white/30 font-sans">
                        <Lock className="w-3 h-3" /> Secured by SubScript Server-Signed Embedded Wallet
                    </div>
                </div>
            </div>
        </div>
    );
}
