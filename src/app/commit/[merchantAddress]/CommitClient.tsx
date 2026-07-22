"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Loader2, CheckCircle, AlertTriangle, ArrowRight, Lock, Shield, ShieldAlert, Zap, MessageSquare
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
    const [amountUsdc, setAmountUsdc] = useState(initialAmount || "2.00");
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [sessionLoaded, setSessionLoaded] = useState(false);

    const [isCommitting, setIsCommitting] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    const [committedTxHash, setCommittedTxHash] = useState<string | null>(null);
    const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);

    const commitRequestKey = useRef<string | null>(null);
    const commitInFlight = useRef(false);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/auth/session")
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setSession(data); })
            .catch(() => { if (!cancelled) setSession({ loggedIn: false }); })
            .finally(() => { if (!cancelled) setSessionLoaded(true); });
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

        try {
            commitRequestKey.current ||= crypto.randomUUID();
            const res = await fetch("/api/user/vault/commit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-request-id": commitRequestKey.current,
                },
                body: JSON.stringify({
                    merchantAddress,
                    amountUsdc,
                    acknowledgeUnverified: acknowledgedUnverified || undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                if (data.code === "UNVERIFIED_MERCHANT") {
                    setAcknowledgedUnverified(true);
                    throw new Error(data.error || "Please review and confirm committing to an unverified merchant.");
                }
                throw new Error(data.error || "Vault commitment failed.");
            }
            commitRequestKey.current = null;
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

            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">commit</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Pay-As-You-Go Vault Escrow</p>
                </div>

                <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40">

                    {/* Merchant Identity */}
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center text-[#00d2b4] font-black uppercase">
                            {(merchant?.name || "M").slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Pay-As-You-Go Service</p>
                            <p className="truncate font-mono text-sm font-bold text-white">{merchant?.name || merchantAddress.slice(0, 8)}</p>
                        </div>
                        {merchant?.verified ? (
                            <div className="ml-auto flex items-center gap-1 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg px-2 py-1">
                                <Shield className="w-3 h-3 text-emerald-400" />
                                <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">Verified</span>
                            </div>
                        ) : (
                            <div className="ml-auto flex items-center gap-1 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-2 py-1">
                                <AlertTriangle className="w-3 h-3 text-amber-400" />
                                <span className="text-[8px] font-bold text-amber-400 uppercase tracking-wider">Unverified</span>
                            </div>
                        )}
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
                                <p className="text-sm font-bold text-white">Vault Committed Successfully!</p>
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
