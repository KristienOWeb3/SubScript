"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { flushSync } from "react-dom";
import RollingNumber from "@/components/ui/RollingNumber";
import {
    Loader2,
    QrCode,
    Send,
    User,
    X,
    Building2,
    Globe,
    CheckCircle2,
    ChevronDown,
    Wallet,
    OutgoingTransactionIcon,
} from "@/components/icons";
import { ChainLogo } from "@/components/ChainLogo";
import { listBridgeRoutes } from "@/lib/cctp/feeEngine";
import type { BridgeRouteOption } from "@/lib/cctp/types";
import { recentRecipients, type RecentRecipient, type RecipientTransaction } from "@/lib/payments/recentRecipients";
import { maxSendAmount, type SendQuote, type SendResult } from "@/lib/payments/sendQuote";

export type SingleResolvedTarget = {
    address: string | null;
    alias: string | null;
    profilePic?: string | null;
    hasAccount?: boolean;
};

export type SenderInfo = {
    wallet: string;
    alias?: string | null;
    email?: string | null;
    profilePic?: string | null;
    isEmbedded?: boolean;
    isGoogle?: boolean;
};

export type Beneficiary = RecentRecipient;

export type SendSingleModalProps = {
    open: boolean;
    onClose: (details?: { isSuccessful?: boolean; result?: SendResult | null }) => void;
    onSubmit: (event: React.FormEvent, selectedChainIdOrDomain: string) => Promise<SendResult | void>;
    getQuote: (input: { amount: string; networkId: string; recipientAddress?: string }) => Promise<SendQuote>;
    recipient: string;
    onRecipientChange: (value: string) => void;
    amount: string;
    onAmountChange: (value: string) => void;
    resolving: boolean;
    resolved: SingleResolvedTarget | null;
    selfSend: boolean;
    loading: boolean;
    status: string | null;
    walletBalance: number;
    balanceKnown?: boolean;
    onScanQr: () => void;
    onGoToBatch: () => void;
    routingNotice?: ReactNode;
    canWithdrawCrossChain?: boolean;
    senderInfo?: SenderInfo;
    onSendSuccess?: (details: SendResult) => void;
    onSendFailure?: (details: SendResult) => void;
    onPresentationPause?: (paused: boolean) => void;
    isMobile?: boolean;
    recentTransactions?: RecipientTransaction[];
};

const EASE = "cubic-bezier(.16,1,.3,1)";
const EASE_EXP = "cubic-bezier(.32,.72,0,1)";
const EASE_CLOSE = "cubic-bezier(.45,0,.1,1)";
const EASE_POP = "cubic-bezier(.22,1,.36,1)";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function animateFlow(element: Element, frames: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): Animation {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return element.animate(frames, reduced && Number(options.duration || 0) < 2000 ? { ...options, duration: 1, delay: 0 } : options);
}

const displayUsdc = (value: string | number) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });

function arrivalEstimateSeconds(arrival?: string): number {
    if (!arrival) return 0;
    if (/instant/i.test(arrival)) return 10;
    const match = arrival.match(/(\d+)\s*(minutes?|seconds?|[ms])\b/i);
    return match ? Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1) : 0;
}

function useNetworkReveal(open: boolean, ref: React.RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        const menu = ref.current;
        if (!open || !menu) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const observer = new IntersectionObserver(entries => {
            let stagger = 0;
            entries.forEach(entry => {
                const row = entry.target as HTMLElement;
                if (!entry.isIntersecting) { row.style.opacity = "0"; return; }
                row.style.opacity = "1";
                row.getAnimations().forEach(animation => animation.cancel());
                if (!reduced) animateFlow(row, [
                    { opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" },
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                ], { duration: 420, delay: 40 + stagger++ * 28, easing: EASE, fill: "backwards" });
            });
        }, { root: menu, threshold: 0.15 });
        menu.querySelectorAll('[role="option"]').forEach(row => observer.observe(row));
        return () => observer.disconnect();
    }, [open, ref]);
}

function useSendQuote({ getQuote, amount, networkId, address, walletBalance }: {
    getQuote: SendSingleModalProps["getQuote"];
    amount: string;
    networkId: string;
    address?: string | null;
    walletBalance: number;
}) {
    /* The network/gas fee is estimated immediately even before an amount is typed,
       falling back to a probe amount so the fee is never stuck on "Awaiting estimate". */
    const minProbe = networkId === "1" ? "10" : "1";
    const quoteAmount = amount && /^\d+(?:\.\d{1,6})?$/.test(amount) && Number(amount) > 0
        ? amount
        : (walletBalance > 0 && walletBalance >= Number(minProbe) ? String(Math.floor(walletBalance * 1_000_000) / 1_000_000) : minProbe);
    const key = `${networkId}:${address || ""}:${quoteAmount}`;
    const [response, setResponse] = useState<{ key: string; quote?: SendQuote; error?: string } | null>(null);
    useEffect(() => {
        let cancelled = false;
        const timer = window.setTimeout(() => {
            getQuote({ amount: quoteAmount, networkId, recipientAddress: address || undefined }).then(quote => {
                if (!cancelled) setResponse({ key, quote });
            }).catch(error => {
                if (!cancelled) setResponse({ key, error: error instanceof Error ? error.message : "Unable to estimate fee." });
            });
        }, 150);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [getQuote, quoteAmount, networkId, address, key]);
    return response?.key === key ? response : null;
}

/* Short address formatting: 0x2134...1df5 */
const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    const clean = addr.trim();
    if (clean.length < 10) return clean;
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
};

const WalletIcon = ({ className = "w-5 h-5 text-current" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11" />
        <circle cx="17" cy="14" r="1.2" />
    </svg>
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                {label}
            </label>
            {children}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * SAFE AVATAR COMPONENT: Uses the platform's profile PFP icon for profiles
 * without custom pictures, maintaining visual consistency across the app.
 * ══════════════════════════════════════════════════════════════════════════════ */
function SafeAvatar({
    src,
    alt = "",
    fallbackText,
    testId,
    className = "w-full h-full object-cover",
    containerClassName = "w-11 h-11 rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] flex items-center justify-center overflow-hidden",
}: {
    src?: string | null;
    alt?: string;
    fallbackText: string;
    walletFallback?: boolean;
    testId?: string;
    className?: string;
    containerClassName?: string;
}) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const isSender = testId === "send-sender-avatar";

    return (
        <div className={containerClassName} data-testid={testId}>
            {src && src !== failedSrc ? (
                <img
                    src={src}
                    alt={alt}
                    onError={() => setFailedSrc(src || null)}
                    className={className}
                />
            ) : (
                <span aria-label={fallbackText || "Profile"} className="flex w-full h-full items-center justify-center bg-black/5 dark:bg-white/10">
                    <User className={`w-1/2 h-1/2 ${isSender ? "text-[#2775CA] dark:text-[#ccff00]" : "text-black/50 dark:text-white/60"}`} />
                </span>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * BENEFICIARY / RECENTLY SENT TO PILLS (PER SELECTED CHAIN)
 * ══════════════════════════════════════════════════════════════════════════════ */
function BeneficiaryPills({
    chain,
    onSelect,
    recentTransactions,
}: {
    chain: string;
    onSelect: (target: string) => void;
    recentTransactions?: RecipientTransaction[];
}) {
    const [storedBeneficiaries, setStoredBeneficiaries] = useState<Beneficiary[]>([]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem("subscript_recent_beneficiaries_by_chain");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    // Filter out any entries where target is truncated
                    const valid = parsed.filter(
                        (b) => b && typeof b.target === "string" && !b.target.includes("…") && !b.target.includes("...")
                    );
                    setStoredBeneficiaries(valid);
                }
            }
        } catch {}
    }, []);

    const activeList = useMemo(
        () => recentRecipients(chain, recentTransactions || [], storedBeneficiaries),
        [chain, storedBeneficiaries, recentTransactions]
    );

    if (!activeList.length) return null;

    return (
        <div className="mt-2 space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40">
                Recent recipients
            </span>
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
                {activeList.map((b) => {
                    const shortAddr = formatShortAddress(b.target || b.address || b.label);
                    const pillText = b.type === "dns" ? b.target : shortAddr;
                    return (
                        <button
                            key={b.id || b.target}
                            type="button"
                            onClick={() => onSelect(b.target)}
                            aria-label={b.type === "dns" ? b.target : `Wallet ${shortAddr}`}
                            title={pillText}
                            className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] px-2.5 py-1 text-xs font-semibold text-black dark:text-[#FFFFF0] shadow-sm transition hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 cursor-pointer"
                        >
                            {b.type === "dns" && b.profilePic ? (
                                <SafeAvatar
                                    src={b.profilePic}
                                    fallbackText={b.label}
                                    className="h-4 w-4 rounded-full object-cover shrink-0"
                                    containerClassName="h-4 w-4 rounded-full flex items-center justify-center overflow-hidden shrink-0"
                                />
                            ) : b.type === "dns" ? (
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10 text-[9px] font-black text-black/60 dark:text-white/70">
                                    {b.label[0]?.toUpperCase() || "A"}
                                </span>
                            ) : (
                                <Wallet className="h-4 w-4 text-black/50 dark:text-white/50 shrink-0" />
                            )}
                            <span className={b.type === "dns" ? "text-[11px] font-semibold text-black dark:text-[#FFFFF0] shrink-0" : "font-mono text-[11px] font-semibold text-black dark:text-[#FFFFF0] shrink-0"}>
                                {pillText}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * MAIN EXPORT: Auto-delegates between Desktop Popup Modal and Mobile Bottom Sheet
 * ══════════════════════════════════════════════════════════════════════════════ */
export default function SendSingleModal(props: SendSingleModalProps) {
    const [isMobileDevice, setIsMobileDevice] = useState(() => typeof window !== "undefined" ? window.innerWidth <= 600 : false);

    useEffect(() => {
        const check = () => setIsMobileDevice(window.innerWidth <= 600);
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    const useMobile = props.isMobile !== undefined ? props.isMobile : isMobileDevice;

    if (!props.open) return null;

    if (!useMobile) {
        return <DesktopSendModal {...props} />;
    }

    return <MobileSendSheet {...props} />;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. DESKTOP SEND MODAL (CENTERED POPUP DIALOG PRESERVED FOR DESKTOP)
 * ══════════════════════════════════════════════════════════════════════════════ */
function DesktopSendModal({
    open,
    onClose,
    onSubmit,
    getQuote,
    recipient,
    onRecipientChange,
    amount,
    onAmountChange,
    resolving,
    resolved,
    selfSend,
    loading,
    status,
    walletBalance,
    balanceKnown = true,
    onScanQr,
    onGoToBatch,
    routingNotice,
    canWithdrawCrossChain = true,
    recentTransactions,
}: SendSingleModalProps) {
    const [sendMethod, setSendMethod] = useState<"onchain" | "bank">("onchain");
    const [selectedNetwork, setSelectedNetwork] = useState<string>("arc");
    const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
    const [routeGasStatus, setRouteGasStatus] = useState<Record<string, { available: boolean; status: string; unavailableReason?: string | null }> | null>(null);
    const [recipientError, setRecipientError] = useState<string | null>(null);
    const [desktopResult, setDesktopResult] = useState<SendResult | null>(null);

    const recipientInputRef = useRef<HTMLInputElement | null>(null);
    const networkMenuRef = useRef<HTMLDivElement | null>(null);
    const networkPopupRef = useRef<HTMLDivElement | null>(null);
    useNetworkReveal(networkMenuOpen, networkPopupRef);

    const networkOptions: BridgeRouteOption[] = useMemo(() => listBridgeRoutes("outbound_withdrawal"), []);
    const currentNetwork = networkOptions.find((n) => n.id === selectedNetwork) || networkOptions[0];
    const isArcRoute = currentNetwork.id === "arc";

    const validateRecipient = (raw: string): string => {
        const cleaned = raw.replace(/\s/g, "");
        if (cleaned !== raw) {
            setRecipientError("Spaces are not allowed");
        } else if (cleaned.length === 0) {
            setRecipientError(null);
        } else if (cleaned.startsWith("0x")) {
            const body = cleaned.slice(2);
            if (!/^[a-fA-F0-9]*$/.test(body)) {
                setRecipientError("Invalid hexadecimal characters");
            } else if (cleaned.length < 42 || cleaned.length > 42) {
                setRecipientError("Address must be 42 characters");
            } else {
                setRecipientError(null);
            }
        } else if (cleaned.endsWith(".sub")) {
            const body = cleaned.slice(0, -4);
            if (body.length === 0) {
                setRecipientError("Enter a name before .sub");
            } else {
                setRecipientError(null);
            }
        } else {
            setRecipientError(null);
        }
        return cleaned;
    };

    /* Escape closes */
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (networkMenuOpen) {
                setNetworkMenuOpen(false);
                return;
            }
            if (!loading) onClose({ isSuccessful: desktopResult?.status === "confirmed", result: desktopResult });
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, loading, onClose, networkMenuOpen, desktopResult]);

    /* Click outside closes network menu */
    useEffect(() => {
        if (!networkMenuOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (networkMenuRef.current?.contains(event.target as Node)) return;
            setNetworkMenuOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [networkMenuOpen]);

    /* Poll live route availability from /api/cctp/routes-status */
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/cctp/routes-status?direction=outbound_withdrawal", {
                    signal: AbortSignal.timeout(5000),
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (cancelled || !Array.isArray(data?.routes)) return;
                const next: Record<string, { available: boolean; status: string; unavailableReason?: string | null }> = {};
                for (const route of data.routes) {
                    if (route && typeof route.id === "string") {
                        next[route.id] = {
                            available: Boolean(route.available),
                            status: String(route.status ?? ""),
                            unavailableReason: route.unavailableReason ?? null,
                        };
                    }
                }
                setRouteGasStatus(next);
            } catch {}
        };
        fetchStatus();
        const interval = window.setInterval(fetchStatus, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [open]);

    const trimmedAmount = amount.trim();
    const isDecimalNumber = /^[0-9]+(\.[0-9]{1,6})?$/.test(trimmedAmount);
    const numericAmount = isDecimalNumber ? parseFloat(trimmedAmount) : 0;
    const amountIsValid = isDecimalNumber && Number.isFinite(numericAmount) && numericAmount > 0;

    const quoteResponse = useSendQuote({ getQuote, amount, networkId: selectedNetwork, address: resolved?.address, walletBalance });
    const quote = quoteResponse?.quote;
    const feeText = quote ? `${quote.estimated ? "~" : ""}${displayUsdc(quote.feeUsdc)} USDC` : "Estimating fee...";
    const exceedsBalance = Boolean(quote && balanceKnown && Number(quote.totalDebitUsdc) > walletBalance);
    const applyMax = async () => {
        try {
            const balance = String(Math.floor(walletBalance * 1_000_000) / 1_000_000);
            const maximumQuote = await getQuote({ amount: balance, networkId: selectedNetwork, recipientAddress: resolved?.address || undefined });
            onAmountChange(maxSendAmount(balance, maximumQuote));
        } catch (error) { setRecipientError(error instanceof Error ? error.message : "Unable to estimate Max."); }
    };

    const currentRouteGas = routeGasStatus?.[currentNetwork.id] ?? null;
    const currentRouteLive = isArcRoute || (currentNetwork.available && Boolean(currentRouteGas?.available));
    const currentUnavailableReason = currentRouteGas?.unavailableReason || currentNetwork.unavailableReason || "Relayer gas reserve low";

    const submitBlocked =
        loading ||
        resolving ||
        !resolved?.address ||
        selfSend ||
        !amountIsValid ||
        !quote ||
        exceedsBalance ||
        !currentRouteLive ||
        (!isArcRoute && !canWithdrawCrossChain);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitBlocked) return;
        try {
            const result = await onSubmit(event, selectedNetwork);
            if (result?.txHash || result?.circleTxId) {
                setDesktopResult(result);
                try {
                    const raw = localStorage.getItem("subscript_recent_beneficiaries_by_chain") || "[]";
                    const list: Beneficiary[] = JSON.parse(raw);
                    const isDns = recipient.endsWith(".sub");
                    const newB: Beneficiary = {
                        id: `b-${Date.now()}`,
                        chain: selectedNetwork,
                        type: isDns ? "dns" : "wallet",
                        target: recipient,
                        label: isDns ? recipient : formatShortAddress(recipient),
                        profilePic: resolved?.profilePic || null,
                        address: resolved?.address || null,
                    };
                    const merged = [newB, ...list.filter((x) => x.target.toLowerCase() !== recipient.toLowerCase())].slice(0, 10);
                    localStorage.setItem("subscript_recent_beneficiaries_by_chain", JSON.stringify(merged));
                } catch {}
            }
        } catch (error) {
            setRecipientError(error instanceof Error ? error.message : "The transfer failed.");
        }
    };

    const summary = desktopResult || quote;
    return (
        <AnimatePresence>
            <motion.div
                key="send-single-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="dashboard-modal-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 font-sans"
                onClick={loading ? undefined : () => onClose({ isSuccessful: desktopResult?.status === "confirmed", result: desktopResult })}
            >
                <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Send USDC"
                    initial={{ opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 8 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    onClick={(event) => event.stopPropagation()}
                    data-testid="send-desktop"
                    className="dashboard-modal-surface relative my-auto w-full max-w-md max-h-[90vh] overflow-y-auto transform-gpu custom-scrollbar rounded-3xl border border-black/10 bg-[#FFFFF0] text-black p-6 shadow-2xl"
                >
                    <div className="relative z-10 mb-5 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-wider text-[#111827]">Send USDC</h3>
                            <p className="mt-1 text-[11px] text-black/55">
                                Pay someone on Arc, or move USDC out to another chain.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onClose({ isSuccessful: desktopResult?.status === "confirmed", result: desktopResult })}
                            disabled={loading}
                            aria-label="Close send dialog"
                            className="rounded-full p-1.5 text-black/40 transition hover:bg-black/5 hover:text-black disabled:opacity-40"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-black/5 p-1 text-xs">
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() => setSendMethod("onchain")}
                            className={`flex items-center justify-center gap-2 rounded-xl py-2 font-bold transition disabled:opacity-50 ${
                                sendMethod === "onchain" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
                            }`}
                        >
                            <Globe className="h-4 w-4" />
                            On-chain
                        </button>
                        <button
                            type="button"
                            disabled
                            onClick={() => setSendMethod("bank")}
                            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 font-bold transition disabled:opacity-50 ${
                                sendMethod === "bank" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
                            }`}
                        >
                            <Building2 className="h-4 w-4" />
                            Offramp
                            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-black/60">
                                Coming soon
                            </span>
                        </button>
                    </div>

                    {sendMethod === "bank" ? (
                        <div className="py-8 text-center space-y-3">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-black/5 text-black/60">
                                <Building2 className="h-6 w-6" />
                            </div>
                            <h4 className="text-sm font-bold text-[#111827]">Bank transfers aren&apos;t ready yet</h4>
                            <p className="mx-auto max-w-xs text-xs leading-relaxed text-black/60">
                                Cashing out straight to a local bank account is still in private testing. For now you can move USDC to any supported chain.
                            </p>
                            <button
                                type="button"
                                onClick={() => setSendMethod("onchain")}
                                className="mt-2 rounded-2xl bg-[#2775CA] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#1f62ab]"
                            >
                                Send on-chain instead
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
                            <Field label="Select network">
                                <div className="relative" ref={networkMenuRef}>
                                    <button
                                        type="button"
                                        disabled={loading}
                                        onClick={() => setNetworkMenuOpen(!networkMenuOpen)}
                                        aria-expanded={networkMenuOpen}
                                        className="flex w-full items-center justify-between rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-bold text-[#111827] shadow-sm transition hover:bg-black/[0.02] disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <div className="flex items-center gap-3">
                                            <ChainLogo chain={currentNetwork.id} size={28} className="h-7 w-7 shrink-0" />
                                            <div className="flex flex-col text-left">
                                                <span>{currentNetwork.name}</span>
                                                <span className="text-[10px] font-normal text-black/50">
                                                    {!currentRouteLive
                                                        ? currentUnavailableReason
                                                        : isArcRoute
                                                          ? "Network gas applies · Arc settlement"
                                                          : `${currentNetwork.feePercentage} fee, ${currentNetwork.estimatedTime.toLowerCase()}`}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {currentRouteLive ? (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                                    Live
                                                </span>
                                            ) : (
                                                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800">
                                                    Unavailable ⛽
                                                </span>
                                            )}
                                            <ChevronDown className="h-4 w-4 text-black/40" />
                                        </div>
                                    </button>

                                    {networkMenuOpen && (
                                        <div ref={networkPopupRef} role="listbox" aria-label="Select network" style={{ animation: "netPopupIn 460ms cubic-bezier(.16,1,.3,1)" }} className="custom-scrollbar absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl">
                                            {networkOptions.map((option) => {
                                                const isSelected = selectedNetwork === option.id;
                                                const isArc = option.id === "arc";
                                                const optionGas = routeGasStatus?.[option.id] ?? null;
                                                const isOptionLive = isArc || (option.available && Boolean(optionGas?.available));
                                                const isOptionDisabled = !isOptionLive || loading;
                                                const unavailableReason = optionGas?.unavailableReason || option.unavailableReason || "Relayer gas reserve low";
                                                return (
                                                    <button
                                                        key={option.id}
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    aria-disabled={!isOptionLive}
                                                        type="button"
                                                        disabled={isOptionDisabled}
                                                        onClick={() => {
                                                            if (isOptionDisabled) return;
                                                            setSelectedNetwork(option.id);
                                                            setNetworkMenuOpen(false);
                                                        }}
                                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs transition ${
                                                            isSelected ? "bg-black/5 font-bold text-[#111827]" : "text-black/80 hover:bg-black/5"
                                                        } ${isOptionDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                                                    >
                                                        <div className="flex items-center gap-2.5">
                                                            <ChainLogo chain={option.id} size={24} className="h-6 w-6 shrink-0" />
                                                            <div className="flex flex-col text-left">
                                                                <span>{option.name}</span>
                                                                <span className="text-[10px] text-black/45">
                                                                    {!isOptionLive ? unavailableReason : isArc ? "Network gas" : `${option.feePercentage} fee`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {isOptionLive ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                                                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                                                    Live
                                                                </span>
                                                            ) : (
                                                                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800">
                                                                    Unavailable ⛽
                                                                </span>
                                                            )}
                                                            {isSelected && isOptionLive && (
                                                                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2775CA]" />
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </Field>

                            <Field label={isArcRoute ? "Recipient wallet address or .sub name" : `Recipient address on ${currentNetwork.name}`}>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <input
                                                ref={recipientInputRef}
                                                value={recipient}
                                                disabled={loading}
                                                onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setRecipientError("Spaces are not allowed"); } }}
                                                onChange={(event) => onRecipientChange(validateRecipient(event.target.value))}
                                                placeholder={isArcRoute ? "alice.sub or 0x..." : `0x... address on ${currentNetwork.name}`}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-semibold text-[#111827] shadow-sm transition placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none focus:ring-2 focus:ring-[#2775CA]/20"
                                            />
                                            {resolving && (
                                                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-black/40">
                                                    <Loader2 className="h-4 w-4 animate-spin text-[#2775CA]" />
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={onScanQr}
                                            disabled={loading}
                                            title="Scan QR Code"
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-black/15 bg-white text-black/60 shadow-sm transition hover:bg-black/5 hover:text-black active:scale-95"
                                        >
                                            <QrCode className="h-4 w-4" />
                                        </button>
                                    </div>

                                    {recipientError && (
                                        <p className="mt-1 text-[11px] font-medium text-red-600">{recipientError}</p>
                                    )}

                                    {/* Beneficiary / Recently Sent Pills */}
                                    <BeneficiaryPills
                                        chain={selectedNetwork}
                                        onSelect={(target) => onRecipientChange(validateRecipient(target))}
                                        recentTransactions={recentTransactions}
                                    />

                                    {resolved && (
                                        <div className="mt-2 flex items-center justify-between rounded-xl bg-black/5 p-2.5 text-[11px]">
                                            <div className="flex items-center gap-2">
                                                <SafeAvatar src={resolved.alias || resolved.hasAccount ? resolved.profilePic : null} fallbackText={resolved.alias || "User"} walletFallback={!resolved.alias && !resolved.hasAccount} containerClassName="h-5 w-5 rounded-full overflow-hidden" />
                                                <div>
                                                    {resolved.alias && (
                                                        <span className="font-bold text-black">{resolved.alias}</span>
                                                    )}
                                                    {resolved.address && (
                                                        <span className="block font-mono text-[10px] text-black/50">
                                                            {formatShortAddress(resolved.address)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Field>

                            {quoteResponse?.error && <p role="alert" className="text-xs text-red-600">{quoteResponse.error}</p>}
                            <Field label="Amount (USDC)">
                                <div className="space-y-1.5">
                                    <div className="relative">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            data-testid="send-amount"
                                        value={amount}
                                            disabled={loading}
                                            onChange={(event) => {
                                                setDesktopResult(null);
                                                const v = event.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                                                onAmountChange(v);
                                            }}
                                            placeholder="0.00"
                                            className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 pr-16 text-xs font-semibold text-[#111827] shadow-sm transition placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none focus:ring-2 focus:ring-[#2775CA]/20"
                                        />
                                        <button
                                            type="button"
                                            disabled={loading || walletBalance <= 0}
                                            onClick={() => void applyMax()}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-black/5 px-2.5 py-1 text-[10px] font-black uppercase text-[#2775CA] transition hover:bg-[#2775CA]/10 active:scale-95 disabled:opacity-40"
                                        >
                                            Max
                                        </button>
                                    </div>
                                    <div className="flex justify-between items-center text-[11px] text-black/50">
                                        <span>Available: <span className="font-mono font-bold">{walletBalance.toFixed(2)} USDC</span></span>
                                        <span data-testid="send-gas-fee">{isArcRoute ? "Network fee" : "Platform fee"}: <span className="font-mono font-bold">{summary ? `${displayUsdc(summary.feeUsdc)} USDC` : feeText}</span></span>
                                    </div>
                                </div>
                            </Field>

                            {isArcRoute && !status?.startsWith("Sent") && !status?.startsWith("Success") && routingNotice}

                            {/* Network Fee & Summary Details (Always Visible) */}
                            <div className="space-y-1.5 rounded-2xl border border-black/10 bg-white/70 p-3.5 text-xs shadow-sm">
                                <div className="flex justify-between text-black/70">
                                    <span>Amount</span>
                                    <span className="font-mono font-bold">{summary ? displayUsdc(summary.amountUsdc) : (amountIsValid ? amount : "0")} USDC</span>
                                </div>
                                <div className="flex justify-between text-black/70">
                                    <span>{isArcRoute ? (summary?.feeLabel || "Network fee") : "Platform fee"}</span>
                                    <span className="font-mono font-bold">{summary ? `${displayUsdc(summary.feeUsdc)} USDC` : feeText}</span>
                                </div>
                                {!isArcRoute && (
                                    <div className="flex justify-between text-black/70">
                                        <span>Arrives in</span>
                                        <span className="font-mono font-bold">{currentNetwork.estimatedTime || "About 15 minutes"}</span>
                                    </div>
                                )}
                                <div className="flex justify-between border-t border-black/10 pt-1.5 font-bold text-[#111827]">
                                    <span>Total received</span>
                                    <span className="font-mono text-[#2775CA]">{summary ? displayUsdc(summary.recipientUsdc) : "0"} USDC</span>
                                </div>
                            </div>

                            {summary && <p className="text-center text-[11px] text-black/60">Wallet debit: {displayUsdc(summary.totalDebitUsdc)} USDC{summary.feeTreatment === "deducted" && ` · ${isArcRoute ? (summary.feeLabel || "Fee") : "Platform fee"} deducted from amount`}</p>}
                            {desktopResult?.status === "pending_attestation" && (
                                <p className="text-center text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl p-2.5">
                                    On its way. You can close this; it will arrive in about 15 minutes.
                                </p>
                            )}
                            {desktopResult && (desktopResult.explorerUrl || desktopResult.txHash) && (
                                <a href={desktopResult.explorerUrl || `${process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "https://explorer.arc.io" : "https://testnet.arcscan.app"}/tx/${desktopResult.txHash}`} target="_blank" rel="noopener noreferrer" className="block text-center text-xs font-bold text-[#2775CA]">View transaction ↗</a>
                            )}
                            {status && (
                                <p className="text-center text-xs font-semibold text-black/70">{status}</p>
                            )}

                            {desktopResult ? (
                                <button
                                    type="button"
                                    onClick={() => onClose({ isSuccessful: desktopResult.status === "confirmed", result: desktopResult })}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] py-3.5 text-xs font-bold text-white shadow-md transition hover:bg-[#1f62ab] active:scale-[0.98] cursor-pointer"
                                >
                                    Done
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={submitBlocked}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] py-3.5 text-xs font-bold text-white shadow-md transition hover:bg-[#1f62ab] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    {loading ? "Processing Transfer..." : isArcRoute ? "Send USDC" : `Bridge to ${currentNetwork.name}`}
                                </button>
                            )}

                            <div className="border-t border-black/10 pt-3 text-center">
                                <button
                                    type="button"
                                    onClick={onGoToBatch}
                                    className="text-xs font-bold text-[#2775CA] hover:underline"
                                >
                                    Switch to batch payouts →
                                </button>
                            </div>
                        </form>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. MOBILE SEND SHEET (EXACT ARC-SEND-FLOW.HTML 120FPS BOTTOM-SHEET & MORPH)
 * ══════════════════════════════════════════════════════════════════════════════ */
function MobileSendSheet({
    open,
    onClose,
    onSubmit,
    getQuote,
    recipient,
    onRecipientChange,
    amount,
    onAmountChange,
    resolving,
    resolved,
    selfSend,
    loading,
    status,
    walletBalance,
    balanceKnown = true,
    onScanQr,
    onGoToBatch,
    canWithdrawCrossChain = true,
    senderInfo,
    onSendSuccess,
    onSendFailure,
    onPresentationPause,
    recentTransactions,
}: SendSingleModalProps) {
    const [view, setView] = useState<"compose" | "review">("compose");
    const [sendMethod, setSendMethod] = useState<"onchain" | "bank">("onchain");
    const [selectedNetwork, setSelectedNetwork] = useState<string>("arc");
    const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
    const [sendingState, setSendingState] = useState<"idle" | "confirming" | "sending" | "success">("idle");
    const [doneReady, setDoneReady] = useState(false);
    const [receiptVisible, setReceiptVisible] = useState(false);
    const [viewTransitioning, setViewTransitioning] = useState(false);
    const closingRef = useRef(false);
    const transitioningRef = useRef(false);
    const commitRef = useRef(false);
    const mountedRef = useRef(true);
    const pendingAnimationsRef = useRef<Animation[]>([]);
    const [recipientError, setRecipientError] = useState<string | null>(null);

    const sheetRef = useRef<HTMLDivElement | null>(null);
    const handleRef = useRef<HTMLDivElement | null>(null);
    const pageRef = useRef<HTMLDivElement | null>(null);
    const tintRef = useRef<HTMLDivElement | null>(null);
    const scrimRef = useRef<HTMLDivElement | null>(null);
    const sliderThumbRef = useRef<HTMLButtonElement | null>(null);
    const sliderFillRef = useRef<HTMLDivElement | null>(null);
    const sliderLabelRef = useRef<HTMLDivElement | null>(null);
    const sliderButtonRef = useRef<HTMLDivElement | null>(null);
    const blurFilterRef = useRef<SVGElement | null>(null);
    const smallLogoRef = useRef<HTMLDivElement | null>(null);
    const heroLogoRef = useRef<HTMLDivElement | null>(null);
    const heroTitleRef = useRef<HTMLHeadingElement | null>(null);
    const heroSubRef = useRef<HTMLParagraphElement | null>(null);
    const arcRingRef = useRef<SVGCircleElement | null>(null);
    const countdownCircleRef = useRef<SVGCircleElement | null>(null);
    const okDiscRef = useRef<HTMLDivElement | null>(null);
    const arrivesBRef = useRef<HTMLElement | null>(null);

    const runTokenRef = useRef(0);
    const intervalRef = useRef<any>(null);

    const networkOptions: BridgeRouteOption[] = useMemo(() => listBridgeRoutes("outbound_withdrawal"), []);
    const currentNetwork = networkOptions.find((n) => n.id === selectedNetwork) || networkOptions[0];
    const isArcRoute = currentNetwork.id === "arc";

    const [routeGasStatus, setRouteGasStatus] = useState<Record<string, { available: boolean; status: string; unavailableReason?: string | null }> | null>(null);

    /* Poll live route availability from /api/cctp/routes-status */
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/cctp/routes-status?direction=outbound_withdrawal", {
                    signal: AbortSignal.timeout(5000),
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (cancelled || !Array.isArray(data?.routes)) return;
                const next: Record<string, { available: boolean; status: string; unavailableReason?: string | null }> = {};
                for (const route of data.routes) {
                    if (route && typeof route.id === "string") {
                        next[route.id] = {
                            available: Boolean(route.available),
                            status: String(route.status ?? ""),
                            unavailableReason: route.unavailableReason ?? null,
                        };
                    }
                }
                setRouteGasStatus(next);
            } catch {}
        };
        fetchStatus();
        const interval = window.setInterval(fetchStatus, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [open]);

    const currentRouteGas = routeGasStatus?.[currentNetwork.id] ?? null;
    const currentRouteLive = isArcRoute || (currentNetwork.available && Boolean(currentRouteGas?.available));
    const currentUnavailableReason = currentRouteGas?.unavailableReason || currentNetwork.unavailableReason || "Relayer gas reserve low";

    /* Recipient validation */
    const validateRecipient = (raw: string): string => {
        const cleaned = raw.replace(/\s/g, "");
        if (cleaned !== raw) {
            setRecipientError("Spaces are not allowed");
        } else if (cleaned.length === 0) {
            setRecipientError(null);
        } else if (cleaned.startsWith("0x")) {
            const body = cleaned.slice(2);
            if (!/^[a-fA-F0-9]*$/.test(body)) {
                setRecipientError("Invalid hexadecimal characters");
            } else if (cleaned.length < 42 || cleaned.length > 42) {
                setRecipientError("Address must be 42 characters");
            } else {
                setRecipientError(null);
            }
        } else if (cleaned.endsWith(".sub")) {
            const body = cleaned.slice(0, -4);
            if (body.length === 0) {
                setRecipientError("Enter a name before .sub");
            } else {
                setRecipientError(null);
            }
        } else {
            setRecipientError(null);
        }
        return cleaned;
    };

    const trimmedAmount = amount.trim();
    const isDecimalNumber = /^[0-9]+(\.[0-9]{1,6})?$/.test(trimmedAmount);
    const numericAmount = isDecimalNumber ? parseFloat(trimmedAmount) : 0;
    const amountIsValid = isDecimalNumber && Number.isFinite(numericAmount) && numericAmount > 0;
    const quoteResponse = useSendQuote({ getQuote, amount, networkId: selectedNetwork, address: resolved?.address, walletBalance });
    const quote = quoteResponse?.quote;
    const feeText = quote ? `${quote.estimated ? "~" : ""}${displayUsdc(quote.feeUsdc)} USDC` : "Estimating fee...";
    const exceedsBalance = Boolean(quote && balanceKnown && Number(quote.totalDebitUsdc) > walletBalance);
    const applyMax = async () => {
        try {
            const balance = String(Math.floor(walletBalance * 1_000_000) / 1_000_000);
            const maximumQuote = await getQuote({ amount: balance, networkId: selectedNetwork, recipientAddress: resolved?.address || undefined });
            onAmountChange(maxSendAmount(balance, maximumQuote));
        } catch (error) { setRecipientError(error instanceof Error ? error.message : "Unable to estimate Max."); }
    };
    const [sentResult, setSentResult] = useState<SendResult | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [reviewQuote, setReviewQuote] = useState<SendQuote | null>(null);
    const [reviewTarget, setReviewTarget] = useState<SingleResolvedTarget | null>(null);
    const [arriveStatus, setArriveStatus] = useState<"idle" | "counting" | "arrived" | "delayed" | "failed">("idle");
    const [visibleArriveStatus, setVisibleArriveStatus] = useState<typeof arriveStatus>("idle");
    const [arriveCountdown, setArriveCountdown] = useState<number | null>(null);
    const statusPollRef = useRef<number | null>(null);
    const statusRequestRef = useRef(false);

    const getExplorerTxUrl = (txHash?: string | null) => {
        if (!txHash) return "";
        const base = process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "https://explorer.arc.io" : "https://testnet.arcscan.app";
        return `${base}/tx/${txHash}`;
    };
    const displayQuote = sentResult || reviewQuote || quote;
    const senderAvatarUrl = senderInfo?.profilePic || null;

    const networkPopupRef = useRef<HTMLDivElement | null>(null);
    const networkTriggerContentRef = useRef<HTMLDivElement | null>(null);
    useNetworkReveal(networkMenuOpen, networkPopupRef);

    const pickNetwork = (netId: string) => {
        const pop = networkPopupRef.current;
        const tw = networkTriggerContentRef.current;
        const tok = runTokenRef.current;
        if (pop) {
            animateFlow(pop, [
                { opacity: 1, transform: "none", filter: "blur(0px)" },
                { opacity: 0, transform: "translateY(-8px) scale(.97)", filter: "blur(6px)" },
            ], { duration: 220, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).onfinish = () => {
                if (tok !== runTokenRef.current) return;
                setNetworkMenuOpen(false);
            };
        } else {
            setSelectedNetwork(netId);
            setNetworkMenuOpen(false);
        }
        if (tw) {
            animateFlow(tw, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(4px)" }], { duration: 130, fill: "forwards" }).onfinish = () => {
                if (tok !== runTokenRef.current) return;
                flushSync(() => setSelectedNetwork(netId));
                tw.getAnimations().forEach(animation => animation.cancel());
                animateFlow(tw, [{ opacity: 0, transform: "translateY(6px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 380, easing: EASE });
            };
        } else setSelectedNetwork(netId);
    };

    const closeNetworkMenu = () => {
        const pop = networkPopupRef.current;
        if (pop) {
            animateFlow(pop, [
                { opacity: 1, transform: "none", filter: "blur(0px)" },
                { opacity: 0, transform: "translateY(-8px) scale(.97)", filter: "blur(6px)" },
            ], { duration: 220, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).onfinish = () => {
                setNetworkMenuOpen(false);
            };
        } else {
            setNetworkMenuOpen(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = requestAnimationFrame(() => {
            sheetRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Close send dialog"]')?.focus({ preventScroll: true });
        });
        return () => {
            cancelAnimationFrame(frame);
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, [open]);

    useEffect(() => {
        const label = arrivesBRef.current;
        if (!open || !label) return;
        if (!["arrived", "delayed", "failed"].includes(arriveStatus)) {
            setVisibleArriveStatus(arriveStatus);
            return;
        }
        let cancelled = false;
        let entrance: Animation | undefined;
        const exit = animateFlow(label, [
            { opacity: 1, filter: "none" },
            { opacity: 0, filter: "blur(3px)" },
        ], { duration: 160, fill: "forwards" });
        void exit.finished.then(() => {
            if (cancelled) return;
            flushSync(() => setVisibleArriveStatus(arriveStatus));
            exit.cancel();
            entrance = animateFlow(label, [
                { opacity: 0, filter: "blur(3px)" },
                { opacity: 1, filter: "none" },
            ], { duration: 220 });
        }).catch(() => {});
        return () => {
            cancelled = true;
            exit.cancel();
            entrance?.cancel();
        };
    }, [open, arriveStatus]);

    /* ── BAR-TO-SHEET MORPH: Open Animation ── */
    useEffect(() => {
        if (!open) return;
        runTokenRef.current++;
        clearInterval(intervalRef.current);
        if (statusPollRef.current) {
            window.clearInterval(statusPollRef.current);
            statusPollRef.current = null;
        }
        setView("compose");
        setSendingState("idle");
        setDoneReady(false);
        setReceiptVisible(false);
        closingRef.current = false;
        transitioningRef.current = false;
        commitRef.current = false;
        mountedRef.current = true;
        setSentResult(null);
        setSendError(null);
        setArriveStatus("idle");
        setArriveCountdown(null);

        const sh = sheetRef.current;
        const pg = pageRef.current;
        const tint = tintRef.current;
        const sc = scrimRef.current;
        if (!sh || !pg) return;

        sh.style.display = "block";

        // Target the 4-menu capsule
        const barEl = (document.getElementById("mobile-nav-capsule") || document.querySelector("aside[aria-label='Mobile navigation bar'] nav")) as HTMLElement | null;
        if (tint && barEl) tint.style.background = getComputedStyle(barEl).background;
        // Target the payments circular button on the right
        const walEl = (document.getElementById("mobile-nav-payments-btn") || document.getElementById("wal")) as HTMLElement | null;

        const FULL = "inset(0px 0px 0px 0px round 28px 28px 0px 0px)";
        const previousVisibility = barEl?.style.visibility || "";

        if (barEl) {
            const b = barEl.getBoundingClientRect();
            const s = sh.getBoundingClientRect();
            const g = {
                T: b.top - s.top,
                R: s.right - b.right,
                B: s.bottom - b.bottom,
                L: b.left - s.left,
                r: b.height / 2,
                w: b.width,
                h: b.height,
            };
            const cp = `inset(${g.T}px ${g.R}px ${g.B}px ${g.L}px round ${g.r}px)`;

            const gh = barEl.cloneNode(true) as HTMLElement;
            gh.id = "ghost-bottom-bar";
            gh.inert = true;
            gh.setAttribute("aria-hidden", "true");
            gh.style.position = "absolute";
            gh.style.pointerEvents = "none";
            gh.style.zIndex = "6";
            gh.style.left = `${g.L}px`;
            gh.style.top = `${g.T}px`;
            gh.style.width = `${g.w}px`;
            gh.style.height = `${g.h}px`;
            gh.style.right = "auto";
            gh.style.bottom = "auto";
            sh.appendChild(gh);

            barEl.style.visibility = "hidden";
            if (sc) sc.style.pointerEvents = "auto";

            // Morph capsule into sheet (480ms) - exact DepositModal opening speed
            animateFlow(sh, [
                { clipPath: cp, filter: "blur(0px)" },
                { filter: "blur(2.5px)", offset: 0.35 },
                { clipPath: FULL, filter: "blur(0px)" },
            ], { duration: 480, easing: EASE_EXP, fill: "forwards" });

            if (tint) animateFlow(tint, { opacity: [1, 0] }, { duration: 340, easing: "ease-out", fill: "forwards" });
            animateFlow(gh, { opacity: [1, 0], filter: ["blur(0px)", "blur(7px)"] }, { duration: 220, easing: "ease-out", fill: "forwards" }).onfinish = () => gh.remove();
            animateFlow(pg, [
                { opacity: 0, transform: "translateY(20px)", filter: "blur(10px)" },
                { opacity: 1, transform: "none", filter: "blur(0px)" },
            ], { duration: 420, delay: 120, easing: EASE_EXP, fill: "backwards" });

            // Disappear the last menu (Payments button) with scale down, translateY and blur
            if (walEl) {
                animateFlow(walEl, [
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                    { opacity: 0, transform: "scale(.8) translateY(10px)", filter: "blur(6px)" },
                ], { duration: 240, easing: "ease-out", fill: "forwards" });
            }

            if (sc) animateFlow(sc, { opacity: [0, 1] }, { duration: 360, fill: "forwards" });
        } else {
            sh.style.clipPath = FULL;
            animateFlow(sh, [
                { transform: "translateY(100%)", filter: "blur(8px)" },
                { transform: "translateY(0%)", filter: "blur(0px)" },
            ], { duration: 420, easing: EASE, fill: "forwards" });
            if (sc) animateFlow(sc, { opacity: [0, 1] }, { duration: 300, fill: "forwards" });
        }
        return () => {
            mountedRef.current = false;
            onPresentationPause?.(false);
            runTokenRef.current++;
            window.clearInterval(intervalRef.current);
            if (statusPollRef.current) {
                window.clearInterval(statusPollRef.current);
                statusPollRef.current = null;
            }
            [sh, closingRef.current ? null : walEl].forEach(element => element?.getAnimations({ subtree: true }).forEach(animation => {
                animation.onfinish = null;
                animation.cancel();
            }));
            [pg, tint, sc].forEach(element => element?.getAnimations().forEach(animation => animation.cancel()));
            pendingAnimationsRef.current.forEach(animation => animation.cancel());
            pendingAnimationsRef.current = [];
            document.getElementById("ghost-bottom-bar")?.remove();
            document.getElementById("ghost-bottom-bar-close")?.remove();
            if (barEl) barEl.style.visibility = previousVisibility;
        };
    }, [open]);

    /* ── BAR-TO-SHEET MORPH: Close Animation ── */
    const handleClose = async () => {
        if (closingRef.current || transitioningRef.current || loading || sendingState === "sending" || sendingState === "confirming" || (sendingState === "success" && !doneReady)) return;
        closingRef.current = true;
        const isSuccessful = arriveStatus === "arrived" || sentResult?.status === "confirmed";
        const currentResult = sentResult;
        runTokenRef.current++;
        clearInterval(intervalRef.current);
        if (statusPollRef.current) {
            window.clearInterval(statusPollRef.current);
            statusPollRef.current = null;
        }
        const sh = sheetRef.current;
        const pg = pageRef.current;
        const tint = tintRef.current;
        const sc = scrimRef.current;
        const barEl = (document.getElementById("mobile-nav-capsule") || document.querySelector("aside[aria-label='Mobile navigation bar'] nav")) as HTMLElement | null;
        const walEl = (document.getElementById("mobile-nav-payments-btn") || document.getElementById("wal")) as HTMLElement | null;
        const FULL = "inset(0px 0px 0px 0px round 28px 28px 0px 0px)";

        if (sh && pg && barEl) {
            const b = barEl.getBoundingClientRect();
            const s = sh.getBoundingClientRect();
            const g = {
                T: b.top - s.top,
                R: s.right - b.right,
                B: s.bottom - b.bottom,
                L: b.left - s.left,
                r: b.height / 2,
                w: b.width,
                h: b.height,
            };
            const cp = `inset(${g.T}px ${g.R}px ${g.B}px ${g.L}px round ${g.r}px)`;

            const gh = barEl.cloneNode(true) as HTMLElement;
            gh.id = "ghost-bottom-bar-close";
            gh.inert = true;
            gh.setAttribute("aria-hidden", "true");
            gh.style.position = "absolute";
            gh.style.pointerEvents = "none";
            gh.style.zIndex = "6";
            gh.style.left = `${g.L}px`;
            gh.style.top = `${g.T}px`;
            gh.style.width = `${g.w}px`;
            gh.style.height = `${g.h}px`;
            gh.style.right = "auto";
            gh.style.bottom = "auto";
            gh.style.opacity = "0";
            sh.appendChild(gh);

            animateFlow(pg, [
                { opacity: 1, transform: "none", filter: "blur(0px)" },
                { opacity: 0, transform: "translateY(16px)", filter: "blur(8px)" },
            ], { duration: 200, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" });

            animateFlow(gh, [
                { opacity: 0, filter: "blur(6px)" },
                { opacity: 1, filter: "blur(0px)" },
            ], { duration: 240, delay: 240, easing: "ease-out", fill: "forwards" });

            if (tint) animateFlow(tint, { opacity: [0, 1] }, { duration: 280, delay: 100, fill: "forwards" });
            if (sc) animateFlow(sc, { opacity: [1, 0] }, { duration: 380, fill: "forwards" });

            const dash = document.querySelector(".user-dashboard-content, .user-dashboard-redesign, main") as HTMLElement | null;
            if (dash) {
                pendingAnimationsRef.current.forEach(animation => animation.cancel());
                dash.getAnimations().forEach((a) => a.cancel());
                dash.style.transform = "";
            }

            await animateFlow(sh, [
                { clipPath: FULL, filter: "blur(0px)" },
                { filter: "blur(2.5px)", offset: 0.55 },
                { clipPath: cp, filter: "blur(0px)" },
            ], { duration: 440, easing: EASE_CLOSE, fill: "forwards" }).finished.catch(() => {});
            if (!mountedRef.current) return;

            barEl.style.visibility = "visible";
            [sh, pg, tint, sc].forEach((e) => e?.getAnimations().forEach((a) => a.cancel()));
            gh.remove();
            sh.style.display = "none";
            if (sc) sc.style.pointerEvents = "none";

            // Reappear the Payments button with scale up and blur clearing
            if (walEl) {
                walEl.getAnimations().forEach(animation => animation.cancel());
                animateFlow(walEl, [
                    { opacity: 0, transform: "scale(.8) translateY(10px)", filter: "blur(6px)" },
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                ], { duration: 320, easing: EASE, fill: "forwards" });
            }
        } else if (sh) {
            await animateFlow(sh, [
                { transform: "translateY(0%)", filter: "blur(0px)" },
                { transform: "translateY(100%)", filter: "blur(8px)" },
            ], { duration: 320, easing: EASE_CLOSE, fill: "forwards" }).finished.catch(() => {});
            if (!mountedRef.current) return;
            sh.style.display = "none";
        }
        onClose({ isSuccessful, result: currentResult });
    };

    /* ── VIEW SWITCH ANIMATION (COMPOSE <-> REVIEW) ── */
    const swapToView = async (nextView: "compose" | "review", dir: number) => {
        if (transitioningRef.current || closingRef.current) return;
        const pg = pageRef.current;
        const sh = sheetRef.current;
        if (!pg || !sh) return;
        transitioningRef.current = true;
        setViewTransitioning(true);
        const h0 = sh.offsetHeight;

        await animateFlow(pg, [
            { opacity: 1, transform: "none", filter: "blur(0px)" },
            { opacity: 0, transform: `translateX(${-dir * 52}px) scale(.98)`, filter: "blur(12px)" },
        ], { duration: 280, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).finished.catch(() => {});
        if (!mountedRef.current) return;

        // Measure the next view only after React has committed its actual geometry.
        flushSync(() => setView(nextView));
        pg.getAnimations().forEach((a) => a.cancel());

        const h1 = sh.offsetHeight;
        if (h0 !== h1) {
            animateFlow(sh, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 560, easing: EASE });
        }

        await animateFlow(pg, [
            { opacity: 0, transform: `translateX(${dir * 52}px) scale(.98)`, filter: "blur(12px)" },
            { opacity: 1, transform: "none", filter: "blur(0px)" },
        ], { duration: 560, easing: EASE }).finished.catch(() => {});
        transitioningRef.current = false;
        if (mountedRef.current) setViewTransitioning(false);
    };

    /* ── SWIPE-TO-SEND SLIDER GESTURE WITH LERP & SVG MOTION BLUR ── */
    useEffect(() => {
        if (view !== "review") return;
        const th = sliderThumbRef.current;
        const fl = sliderFillRef.current;
        const lb = sliderLabelRef.current;
        const bl = blurFilterRef.current;
        const sl = th?.parentElement;
        if (!th || !fl || !lb || !sl) return;

        let x0 = 0;
        let tgt = 0;
        let cur = 0;
        let drag = false;
        let max = sl.clientWidth - 58;
        let raf = 0;
        let resetTimer: ReturnType<typeof setTimeout> | null = null;
        const restoreThumb = () => {
            th.style.animation = "";
            th.style.filter = "";
            if (bl) bl.setAttribute("stdDeviation", "0 0");
        };

        const update = () => {
            const v = tgt - cur;
            cur += v * 0.32;
            if (bl) {
                bl.setAttribute("stdDeviation", `${Math.min(8, Math.abs(v) * 0.3)} 0`);
            }
            th.style.transform = `translateX(${cur}px)`;
            fl.style.width = `${cur + 58}px`;
            lb.style.opacity = `${Math.max(0, 1 - (cur / max) * 1.8)}`;

            if (Math.abs(v) > 0.05 || drag) {
                raf = requestAnimationFrame(update);
            } else {
                raf = 0;
            }
        };

        const kick = () => {
            if (!raf) raf = requestAnimationFrame(update);
        };

        const onDown = (e: PointerEvent) => {
            if (sendingState !== "idle" || commitRef.current || transitioningRef.current) return;
            if (resetTimer) clearTimeout(resetTimer);
            drag = true;
            x0 = e.clientX;
            max = sl.clientWidth - 58;
            th.setPointerCapture(e.pointerId);
            th.style.animation = "none";
            th.style.filter = "url(#mbx)";
            kick();
        };

        const onMove = (e: PointerEvent) => {
            if (!drag) return;
            tgt = Math.max(0, Math.min(max, e.clientX - x0));
            kick();
        };

        const onUp = () => {
            if (!drag) return;
            drag = false;
            if (tgt / max > 0.9) {
                tgt = cur = max;
                kick();
                handleCommitSend();
            } else {
                tgt = 0;
                kick();
                resetTimer = setTimeout(restoreThumb, 500);
            }
        };

        th.addEventListener("pointerdown", onDown);
        th.addEventListener("pointermove", onMove);
        th.addEventListener("pointerup", onUp);
        const onCancel = () => { drag = false; tgt = 0; kick(); resetTimer = setTimeout(restoreThumb, 500); };
        th.addEventListener("pointercancel", onCancel);

        return () => {
            th.removeEventListener("pointerdown", onDown);
            th.removeEventListener("pointermove", onMove);
            th.removeEventListener("pointerup", onUp);
            th.removeEventListener("pointercancel", onCancel);
            cancelAnimationFrame(raf);
            if (resetTimer) clearTimeout(resetTimer);
        };
    }, [view, sendingState]);

    /* ── SEND COMMIT TIMELINE (EXACT TIMINGS FROM ARC-SEND-FLOW.HTML) ── */
    async function handleCommitSend() {
        if (!isReadyForReview || loading || sendingState !== "idle" || commitRef.current || transitioningRef.current || closingRef.current) return;
        commitRef.current = true;
        onPresentationPause?.(true);
        setSendError(null);
        const tok = ++runTokenRef.current;
        setSendingState("confirming");
        const th = sliderThumbRef.current;
        const fl = sliderFillRef.current;
        const lb = sliderLabelRef.current;
        const bt = sliderButtonRef.current;
        const sl = th?.parentElement;

        if (sl) sl.classList.add("sl-cf");
        // Every activation shares the completed swipe position before the thumb exits.
        if (th && sl) th.style.transform = `translateX(${Math.max(0, sl.clientWidth - 58)}px)`;
        if (fl) {
            fl.style.transition = "width .15s ease-out";
            fl.style.width = "100%";
        }
        if (th) {
            animateFlow(th, [
                { opacity: 1, transform: `${th.style.transform} scale(1)` },
                { opacity: 0, transform: `${th.style.transform} scale(0.6)` },
            ], { duration: 160, fill: "forwards" });
        }
        if (lb) lb.style.opacity = "0";
        if (bt) {
            animateFlow(bt, [
                { opacity: 0, filter: "blur(7px)" },
                { opacity: 1, filter: "blur(0px)" },
            ], { duration: 300, delay: 80, easing: EASE, fill: "forwards" });
        }

        // 0 to 0.28s: fade out top and review header with blur
        const a = smallLogoRef.current?.getBoundingClientRect();
        document.querySelectorAll("#sheet-review-header, #sheet-review-top").forEach((el) => {
            animateFlow(el as HTMLElement, [{ opacity: 1, filter: "none" }, { opacity: 0, filter: "blur(6px)" }], { duration: 280, fill: "forwards" });
        });

        const hero = document.getElementById("sheet-sending-hero");
        if (hero) hero.style.opacity = "1";
        if (smallLogoRef.current) smallLogoRef.current.style.visibility = "hidden";

        // Logo flight to center: grow to 84px with 9px mid-flight blur at offset 0.4
        const hl = heroLogoRef.current;
        let logoFlight: Animation | null = null;
        if (a && hl) {
            const b = hl.getBoundingClientRect();
            const s = a.width / b.width;
            logoFlight = animateFlow(hl, [
                { transform: `translate(${a.left + a.width / 2 - b.left - b.width / 2}px, ${a.top + a.height / 2 - b.top - b.height / 2}px) scale(${s})`, filter: "blur(0px)" },
                { filter: "blur(9px)", offset: 0.4 },
                { transform: "none", filter: "blur(0px)" },
            ], { duration: 680, easing: EASE });
        }

        if (heroTitleRef.current) {
            animateFlow(heroTitleRef.current, [{ opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 320, delay: 250, fill: "backwards" });
        }
        if (heroSubRef.current) {
            animateFlow(heroSubRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 300, fill: "backwards" });
        }
        if (arcRingRef.current) {
            animateFlow(arcRingRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: 200, fill: "backwards" });
        }

        setSendingState("sending");

        // Only a successful platform result can enter the Sent state.
        try {
            const result = await onSubmit({ preventDefault: () => {} } as React.FormEvent, selectedNetwork);
            if (!result?.txHash && !result?.circleTxId) throw new Error("The transfer was not completed. Check the status and try again.");
            if (tok !== runTokenRef.current) return;
            // Immediate callback: refresh parent dashboard balances and transaction feed
            // without waiting for additional UI animation delays.
            if (onSendSuccess) onSendSuccess(result);
            // Let the existing logo flight finish before another transform owns it.
            // Settlement and balance refresh are already proceeding independently.
            if (logoFlight) await logoFlight.finished.catch(() => {});
            if (tok !== runTokenRef.current) return;
            await handleSuccessSequence(tok, result);
        } catch (error) {
            if (tok !== runTokenRef.current) return;
            setSendError(error instanceof Error ? error.message : "The transfer failed. Please try again.");
            setSendingState("idle");
            commitRef.current = false;
            onPresentationPause?.(false);
            await swapToView("compose", -1);
        }

    };

    /* ── SUCCESS SEQUENCE (RING CLOSE, GREEN DISC, 12 PARTICLES, TITLE MORPH, COUNTDOWN) ── */
    const handleSuccessSequence = async (tok: number, result: SendResult) => {
        const txHash = result.txHash;
        setSentResult(result);
        setSendingState("success");
        if (txHash) {
            try {
                const raw = localStorage.getItem("subscript_recent_beneficiaries_by_chain") || "[]";
                const list: Beneficiary[] = JSON.parse(raw);
                const isDns = recipient.endsWith(".sub");
                const newB: Beneficiary = {
                    id: `b-${Date.now()}`,
                    chain: selectedNetwork,
                    type: isDns ? "dns" : "wallet",
                    target: recipient,
                    label: isDns ? recipient : formatShortAddress(recipient),
                    profilePic: resolved?.profilePic || null,
                    address: resolved?.address || null,
                };
                const merged = [newB, ...list.filter((x) => x.target.toLowerCase() !== recipient.toLowerCase())].slice(0, 10);
                localStorage.setItem("subscript_recent_beneficiaries_by_chain", JSON.stringify(merged));
            } catch {}
        }

        const ra = arcRingRef.current;
        const hl = heroLogoRef.current;
        const ok = okDiscRef.current;

        // 1. Ring closes into full circle (video 1.50-1.60)
        if (ra) {
            ra.style.animation = "none";
            await animateFlow(ra, [
                { strokeDasharray: "80 260", transform: "rotate(0deg)" },
                { strokeDasharray: "364.4 0", transform: "rotate(150deg)" },
            ], { duration: 120, easing: "ease-out", fill: "forwards" }).finished.catch(() => {});
            if (tok !== runTokenRef.current) return;
            animateFlow(ra, { opacity: [1, 0] }, { duration: 80, fill: "forwards" });
        }

        // 2. Disc shrinks to .68 while crossfading into solid green disc (#30D158), then grows back
        if (hl) {
            animateFlow(hl, [
                { transform: "scale(1)", opacity: 1, filter: "blur(0px)", easing: "ease-in" },
                { transform: "scale(.68)", opacity: 0, filter: "blur(2px)", offset: 0.3 },
                { transform: "scale(1)", opacity: 0 },
            ], { duration: 250, fill: "forwards" });
        }
        if (ok) {
            ok.style.opacity = "1";
            animateFlow(ok, [
                { transform: "scale(1)", opacity: 0, easing: "ease-in" },
                { transform: "scale(.68)", opacity: 1, offset: 0.3, easing: EASE_POP },
                { transform: "scale(1)", opacity: 1 },
            ], { duration: 250, fill: "forwards" });
            const checkSvg = ok.querySelector("svg");
            if (checkSvg) {
                animateFlow(checkSvg, [
                    { transform: "scale(.2)", opacity: 0, filter: "blur(3px)" },
                    { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
                ], { duration: 300, delay: 90, easing: EASE_POP, fill: "backwards" });
            }

            // 3. 12 dots ring the disc, drift out and fade (1.68-2.05)
            const hw = document.getElementById("sheet-hero-wrapper");
            if (hw) {
                for (let i = 0; i < 12; i++) {
                    const d = document.createElement("i");
                    d.className = "absolute w-[3px] h-[3px] rounded-full bg-[#30D158] opacity-0 pointer-events-none";
                    d.style.left = "61px";
                    d.style.top = "61px";
                    hw.appendChild(d);
                    const an = (i / 12) * 6.283 + 0.26;
                    const r = i % 2 ? 56 : 60;
                    animateFlow(d, [
                        { opacity: 0, transform: `translate(${Math.cos(an) * r}px, ${Math.sin(an) * r}px) scale(1)` },
                        { opacity: 1, offset: 0.15 },
                        { opacity: 0, transform: `translate(${Math.cos(an) * (r + 16)}px, ${Math.sin(an) * (r + 16)}px) scale(.4)` },
                    ], { duration: 620, delay: 90 + (i % 3) * 30, easing: "ease-out", fill: "both" }).onfinish = () => d.remove();
                }
            }
        }

        // 4. Title morph: "Sending…" keeps "Sen", old letters blur out, "t" pops in
        setTimeout(() => {
            if (tok === runTokenRef.current) setReceiptVisible(true);
        }, 120);
        const tt = heroTitleRef.current;
        if (tt) {
            const oldSpans = Array.from(tt.children) as HTMLElement[];
            // "Sending…" has 8 letters: S, e, n, d, i, n, g, …
            // Keep first 3 ("Sen"), animate away rest
            oldSpans.slice(3).forEach((s, idx) => {
                const w = s.offsetWidth;
                animateFlow(s, [
                    { opacity: 1, filter: "blur(0px)", width: `${w}px` },
                    { opacity: 0, filter: "blur(5px)", width: "0px" },
                ], { duration: 260, delay: idx * 32, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }).onfinish = () => s.remove();
            });

            setTimeout(() => {
                if (tok !== runTokenRef.current) return;
                const tSpan = document.createElement("span");
                tSpan.textContent = "t";
                tSpan.className = "inline-block";
                tSpan.style.color = "inherit";
                tt.appendChild(tSpan);
                animateFlow(tSpan, [
                    { opacity: 0, transform: "scale(.5)", filter: "blur(5px)" },
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                ], { duration: 320, easing: EASE, fill: "backwards" });
            }, 240);
        }

        // 6. Button text blurs out, "Done" blurs in (t = 170ms)
        setTimeout(() => {
            if (tok !== runTokenRef.current) return;
            const bt = sliderButtonRef.current;
            if (bt) {
                animateFlow(bt, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 100, fill: "forwards" }).onfinish = () => {
                    if (tok !== runTokenRef.current) return;
                    bt.textContent = "Done";
                    animateFlow(bt, [{ opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 200, fill: "forwards" });
                };
            }
        }, 170);

        await wait(430);
        if (tok !== runTokenRef.current) return;

        onPresentationPause?.(false);
        setDoneReady(true);
        if (typeof handleRef !== "undefined" && handleRef?.current) animateFlow(handleRef.current, { opacity: [0, 1] }, { duration: 250, fill: "forwards" });
        const totalSeconds = arrivalEstimateSeconds(result.arrival) || (selectedNetwork === "arc" ? 10 : 0);
        if (result.status === "confirmed") {
            if (typeof setArriveStatus === "function") setArriveStatus("arrived");
            const rc = countdownCircleRef.current;
            if (rc) {
                rc.style.stroke = "#30D158";
                rc.style.opacity = "1";
            }
        } else if ((result.status === "pending" || result.status === "pending_attestation") && totalSeconds > 0) {
            if (typeof setArriveStatus === "function") setArriveStatus("counting");
            setArriveCountdown(totalSeconds);
            const isArc = selectedNetwork === "arc";
            const rc = countdownCircleRef.current;
            if (rc && isArc) {
                rc.style.stroke = "currentColor";
                rc.style.strokeDasharray = "364.4";
                animateFlow(rc, [{ opacity: 0 }, { opacity: 0.9 }], { duration: 250, fill: "forwards" });
                animateFlow(rc, [{ strokeDashoffset: 0 }, { strokeDashoffset: 364.4 }], {
                    duration: totalSeconds * 1000,
                    easing: "linear",
                    fill: "forwards",
                });
            }

            const started = Date.now();
            intervalRef.current = window.setInterval(() => {
                if (tok !== runTokenRef.current) {
                    window.clearInterval(intervalRef.current);
                    return;
                }
                const remaining = Math.max(0, totalSeconds - Math.floor((Date.now() - started) / 1000));
                setArriveCountdown(remaining);
                if (remaining === 0) {
                    window.clearInterval(intervalRef.current);
                    if (typeof setArriveStatus === "function") setArriveStatus(prev => prev === "counting" ? "delayed" : prev);
                }
            }, 1000);

            // A bridge burn is only the origin leg; arrival requires destination settlement.
            if ((result.circleTxId || result.txHash || result.transferId) && typeof window !== "undefined" && typeof fetch === "function") {
                const pollStart = Date.now();
                statusPollRef.current = window.setInterval(async () => {
                    if (tok !== runTokenRef.current) {
                        if (statusPollRef.current) window.clearInterval(statusPollRef.current);
                        return;
                    }
                    if (statusRequestRef.current) return;
                    statusRequestRef.current = true;
                    try {
                        const params = new URLSearchParams();
                        if (result.circleTxId) params.set("circleTxId", result.circleTxId);
                        if (result.txHash) params.set("txHash", result.txHash);
                        const url = result.status === "pending_attestation"
                            ? `/api/user/cctp/status/${encodeURIComponent(result.transferId || result.txHash)}`
                            : `/api/user/wallet/send/status?${params.toString()}`;
                        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
                        if (tok !== runTokenRef.current) return;
                        if (!res.ok) return;
                        const response = await res.json();
                        const data = result.status === "pending_attestation" ? {
                            status: response.transfer?.status === "completed" && response.transfer?.mintTxHash ? "confirmed" : response.transfer?.status === "failed" ? "failed" : "pending",
                            // Destination mint proves arrival; origin burn remains the ledger identity.
                            txHash: result.txHash,
                        } : response;
                        if (tok !== runTokenRef.current) return;
                        if (data.status === "confirmed") {
                            if (statusPollRef.current) {
                                window.clearInterval(statusPollRef.current);
                                statusPollRef.current = null;
                            }
                            window.clearInterval(intervalRef.current);
                            if (typeof setArriveStatus === "function") setArriveStatus("arrived");
                            if (rc) {
                                rc.getAnimations().forEach((a) => a.cancel());
                                rc.style.stroke = "#30D158";
                                rc.style.opacity = "1";
                            }
                            {
                                const updatedHash = data.txHash || result.txHash;
                                const updated = { ...result, txHash: updatedHash, explorerUrl: isArc && updatedHash ? getExplorerTxUrl(updatedHash) : result.explorerUrl, status: "confirmed" as const };
                                setSentResult(updated);
                                if (onSendSuccess) onSendSuccess(updated);
                            }
                        } else if (data.status === "failed") {
                            if (statusPollRef.current) {
                                window.clearInterval(statusPollRef.current);
                                statusPollRef.current = null;
                            }
                            window.clearInterval(intervalRef.current);
                            const failed = { ...result, status: "failed" as const };
                            setSentResult(failed);
                            onSendFailure?.(failed);
                            if (typeof setArriveStatus === "function") setArriveStatus("failed");
                            if (rc) rc.getAnimations().forEach(animation => animation.cancel());
                        }
                    } catch {
                        // ignore network blips
                    } finally {
                        statusRequestRef.current = false;
                    }
                    if (Date.now() - pollStart > (isArc ? 90_000 : 30 * 60_000)) {
                        if (statusPollRef.current) {
                            window.clearInterval(statusPollRef.current);
                            statusPollRef.current = null;
                        }
                    }
                }, 1200);
            }
        }

    };

    const isReadyForReview = amountIsValid && Boolean(quote) && !exceedsBalance && Boolean(resolved?.address) && !recipientError && !selfSend && !resolving && currentRouteLive && (isArcRoute || canWithdrawCrossChain);

    return (
        <div id="sheet-wrapper" className="fixed inset-0 overflow-hidden z-[100] flex flex-col justify-end pointer-events-none font-sans select-none">
            {/* Scrim Overlay */}
            <div
                ref={scrimRef}
                id="scrim-overlay"
                onClick={handleClose}
                className="absolute inset-0 bg-[#2A302A]/70 pointer-events-none opacity-0 transition-opacity"
            />

            {/* SVG Motion Blur Filter for Lerp Slider */}
            <svg width="0" height="0" className="absolute pointer-events-none" style={{ position: "absolute" }}>
                <filter id="mbx" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur ref={blurFilterRef as any} stdDeviation="0 0" />
                </filter>
            </svg>

            {/* Bottom Sheet Card */}
            <section
                ref={sheetRef}
                id="sheet-card"
                data-testid="send-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Send USDC"
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.stopPropagation();
                        if (networkMenuOpen) closeNetworkMenu();
                        else void handleClose();
                    }
                    if (event.key === "Tab") {
                        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')).filter(element => element.getClientRects().length && !element.closest('[inert]'));
                        const first = controls[0];
                        const last = controls[controls.length - 1];
                        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                    }
                }}
                className="pointer-events-auto relative w-full max-w-[430px] mx-auto bg-[#FDFEF3] dark:bg-[#15181F] text-[#111827] dark:text-[#F1F3F8] rounded-t-[28px] px-[20px] pt-[14px] pb-[22px] shadow-2xl overflow-y-auto overscroll-contain will-change-transform max-h-[94dvh]"
                style={{
                    boxSizing: "border-box",
                    paddingBottom: "max(22px, env(safe-area-inset-bottom, 0px))",
                }}
            >
                {/* Bar Tint Layer during morph */}
                <div
                    ref={tintRef}
                    id="sheet-bar-tint"
                    className="absolute inset-0 pointer-events-none z-[5] opacity-0 bg-[#FDFEF3] dark:bg-[#15181F]"
                />

                {/* Page Content Container */}
                <div ref={pageRef} id="sheet-page-content" className="relative z-20">
                    {/* Top Drag Handle */}
                    <div ref={handleRef} className="w-[40px] h-[4px] rounded-full bg-black/15 dark:bg-white/15 mx-auto mb-[4px] opacity-0" />

                    {view === "compose" ? (
                        /* ── STEP 1: COMPOSE VIEW ── */
                        <div key="compose-view" className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-black uppercase tracking-wider text-[#111827] dark:text-white">
                                    Send USDC
                                </h2>
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    aria-label="Close send dialog"
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition"
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="text-xs text-black/50 dark:text-white/50 -mt-2">
                                Pay someone on Arc, or move USDC out to another chain.
                            </p>

                            {/* Tabs */}
                            <div className="flex gap-1.5 rounded-2xl bg-black/5 dark:bg-white/5 p-1 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setSendMethod("onchain")}
                                    className={`flex flex-1 items-center justify-center gap-1.5 py-2 font-bold rounded-xl transition ${
                                        sendMethod === "onchain" ? "bg-white dark:bg-[#1D2129] text-black dark:text-white shadow-sm" : "text-black/50 dark:text-white/50"
                                    }`}
                                >
                                    <Globe className="h-3.5 w-3.5" /> On-chain
                                </button>
                                <button
                                    type="button"
                                    disabled
                                    className="flex flex-1 items-center justify-center gap-1.5 py-2 font-bold rounded-xl text-black/40 dark:text-white/30 opacity-60"
                                >
                                    <Building2 className="h-3.5 w-3.5" /> Offramp <em className="not-italic text-[8px] font-black uppercase bg-[#2775CA]/20 text-[#2775CA] px-1.5 py-0.5 rounded">Coming soon</em>
                                </button>
                            </div>

                            {/* Network Dropdown */}
                            <div className="space-y-1">
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                                    Select network
                                </label>
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => (networkMenuOpen ? closeNetworkMenu() : setNetworkMenuOpen(true))}
                                        className="flex w-full items-center justify-between rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-[#1D2129] px-3.5 py-2.5 text-xs font-bold shadow-sm transition hover:bg-black/[0.02]"
                                        aria-haspopup="listbox"
                                        aria-expanded={networkMenuOpen}
                                    >
                                        <div ref={networkTriggerContentRef} className="flex items-center gap-2.5">
                                            <ChainLogo chain={currentNetwork.id} size={28} className="h-7 w-7 shrink-0" />
                                            <div className="flex flex-col text-left">
                                                <span className="text-sm font-bold">{currentNetwork.name}</span>
                                                <span className="text-[10px] font-normal text-black/50 dark:text-white/50">
                                                    {isArcRoute ? "Network gas applies · Arc settlement" : `Fee ${currentNetwork.feePercentage} · ${currentNetwork.estimatedTime}`}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {currentRouteLive ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-[#30D158]/15 text-[#1E9E42] px-2 py-0.5 text-[9px] font-bold">
                                                    <i className="w-1.5 h-1.5 rounded-full bg-[#30D158] send-live-dot" /> Live
                                                </span>
                                            ) : (
                                                <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[9px] font-bold">
                                                    Unavailable ⛽
                                                </span>
                                            )}
                                            <ChevronDown className={`h-4 w-4 text-black/40 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] ${networkMenuOpen ? "rotate-180" : ""}`} />
                                        </div>
                                    </button>

                                    {/* Dropdown Menu */}
                                    {networkMenuOpen && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={closeNetworkMenu} />
                                            <div
                                                ref={networkPopupRef}
                                                data-testid="send-network-menu"
                                                role="listbox"
                                                aria-label="Select network"
                                                style={{ animation: "netPopupIn 460ms cubic-bezier(.16,1,.3,1)" }}
                                                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] p-1.5 shadow-2xl backdrop-blur-md"
                                            >
                                                {networkOptions.map((opt) => {
                                                    const isSel = selectedNetwork === opt.id;
                                                    const isArc = opt.id === "arc";
                                                    const optionGas = routeGasStatus?.[opt.id] ?? null;
                                                    const isOptLive = isArc || (opt.available && Boolean(optionGas?.available));
                                                    return (
                                                        <button
                                                            key={opt.id}
                                                            data-testid={`send-network-option-${opt.id}`}
                                                            role="option"
                                                            aria-selected={isSel}
                                                            aria-disabled={!isOptLive}
                                                            type="button"
                                                            onClick={(e) => {
                                                                if (!isOptLive) {
                                                                    const btn = e.currentTarget;
                                                                    animateFlow(btn, [
                                                                        { transform: "none" },
                                                                        { transform: "translateX(-6px)" },
                                                                        { transform: "translateX(5px)" },
                                                                        { transform: "translateX(-3px)" },
                                                                        { transform: "none" },
                                                                    ], { duration: 380, easing: "ease-out" });
                                                                    return;
                                                                }
                                                                pickNetwork(opt.id);
                                                            }}

                                                            className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition ${
                                                                isSel ? "bg-black/5 dark:bg-white/10 font-bold" : "hover:bg-black/5 dark:hover:bg-white/5"
                                                            } ${!isOptLive ? "opacity-50" : ""}`}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <ChainLogo chain={opt.id} size={24} className="h-6 w-6 shrink-0" />
                                                                <div className="flex flex-col text-left">
                                                                    <span>{opt.name}</span>
                                                                    <small className="text-[10px] text-black/50 dark:text-white/50">
                                                                        {isArc ? "Network gas" : `${opt.feePercentage} fee`}
                                                                    </small>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-[11px]">{opt.estimatedTime}</span>
                                                                {isOptLive ? (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#30D158]/15 text-[#1E9E42] px-1.5 py-0.5 text-[8px] font-bold">
                                                                        <i className="w-1.5 h-1.5 rounded-full bg-[#30D158] send-live-dot" /> Live
                                                                    </span>
                                                                ) : (
                                                                    <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[8px] font-bold">
                                                                        Unavailable ⛽
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Recipient Input */}
                            <div className="space-y-1">
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                                    {isArcRoute ? "Recipient wallet address or .sub name" : `Recipient address on ${currentNetwork.name}`}
                                </label>
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1 flex items-center rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-[#1D2129] px-3.5 py-2.5 shadow-sm focus-within:border-[#2775CA] focus-within:ring-2 focus-within:ring-[#2775CA]/20 transition">
                                        <input
                                            value={recipient}
                                            onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setRecipientError("Spaces are not allowed"); } }}
                                            onChange={(e) => onRecipientChange(validateRecipient(e.target.value))}
                                            placeholder={isArcRoute ? "alice.sub or 0x…" : `0x… address on ${currentNetwork.name}`}
                                            className="w-full bg-transparent text-xs font-semibold text-[#111827] dark:text-[#FFFFF0] placeholder:text-black/35 dark:placeholder:text-white/35 focus:outline-none"
                                        />
                                        {/* Pop-in Destination Icon */}
                                        <div className="shrink-0 flex items-center justify-center pl-2">
                                            {resolving ? (
                                                <Loader2 className="h-4 w-4 animate-spin text-[#2775CA]" />
                                            ) : resolved?.address && !recipientError ? (
                                                <div key={`${resolved.address}:${resolved.profilePic || ""}`} className="send-recipient-reveal">
                                                <SafeAvatar
                                                    src={resolved?.alias || resolved?.hasAccount ? resolved.profilePic : null}
                                                    fallbackText={resolved?.alias || "User"}
                                                    walletFallback={!resolved?.alias && !resolved?.hasAccount}
                                                    className="h-5 w-5 rounded-full object-cover"
                                                    containerClassName="h-5 w-5 rounded-full flex items-center justify-center overflow-hidden"
                                                />
                                                </div>
                                            ) : (
                                                <User className="h-4 w-4 text-black/40 dark:text-white/40" />
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onScanQr}
                                        title="Scan QR Code"
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-[#1D2129] text-black/60 dark:text-white/60 shadow-sm transition hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
                                    >
                                        <QrCode className="h-5 w-5" />
                                    </button>
                                </div>

                                <div className={`send-validation-hint text-[11px] font-medium text-red-600 dark:text-red-400 ${recipientError ? "is-visible" : ""}`} aria-live="polite">{recipientError}</div>

                                {/* Beneficiary / Recently Sent Pills */}
                                <BeneficiaryPills
                                    chain={selectedNetwork}
                                    onSelect={(target) => onRecipientChange(validateRecipient(target))}
                                    recentTransactions={recentTransactions}
                                />
                            </div>

                            {/* Amount Input */}
                            <div className="space-y-1">
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                                    Amount (USDC)
                                </label>
                                <div className="relative flex items-center rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-[#1D2129] px-3.5 py-2.5 shadow-sm focus-within:border-[#2775CA] focus-within:ring-2 focus-within:ring-[#2775CA]/20 transition">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        data-testid="send-amount"
                                        value={amount}
                                        onChange={(e) => {
                                            const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                                            onAmountChange(v);
                                        }}
                                        placeholder="0.00"
                                        className="w-full bg-transparent text-sm font-bold text-[#111827] dark:text-[#FFFFF0] placeholder:text-black/35 dark:placeholder:text-white/35 focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        disabled={walletBalance <= 0 || !resolved?.address || resolving || loading}
                                        onClick={() => void applyMax()}
                                        className="shrink-0 rounded-xl bg-black/5 dark:bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase text-[#2775CA] dark:text-[#6A8BE8] transition hover:bg-[#2775CA]/20 active:scale-95 cursor-pointer disabled:opacity-40"
                                    >
                                        MAX
                                    </button>
                                </div>
                                <div className="flex justify-between items-center text-[11px] text-black/50 dark:text-white/50 pt-0.5">
                                    <span>Available: <strong className="font-mono">{walletBalance.toFixed(2)} USDC</strong></span>
                                    <span data-testid="send-gas-fee">{isArcRoute ? (quote?.feeLabel || "Network fee") : "Platform fee"}: <strong className="font-mono">{quote ? `${displayUsdc(quote.feeUsdc)} USDC` : feeText}</strong></span>
                                </div>
                            </div>

                            {(quoteResponse?.error || sendError || status) && <p role="alert" className="text-xs text-red-600">{status || quoteResponse?.error || sendError}</p>}
                            {/* Review Action Button */}
                            <button
                                type="button"
                                disabled={!isReadyForReview || viewTransitioning}
                                data-testid="send-review"
                                onClick={() => { setReviewQuote(quote || null); setReviewTarget(resolved); void swapToView("review", 1); }}
                                className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-md transition-all duration-300 ${
                                    isReadyForReview
                                        ? "bg-[#2775CA] hover:bg-[#1f62ab] active:scale-95 cursor-pointer"
                                        : "bg-black/20 dark:bg-white/20 opacity-50 cursor-not-allowed"
                                }`}
                                style={isReadyForReview ? { animation: "sendReviewReady 480ms cubic-bezier(.16,1,.3,1)" } : undefined}
                            >
                                <Send className="h-4 w-4" /> Review
                            </button>

                            {/* Footer */}
                            <div className="border-t border-black/10 dark:border-white/10 pt-3 text-center space-y-0.5">
                                <span className="block text-xs font-bold text-black/70 dark:text-white/70">
                                    Send to several people at once
                                </span>
                                <button
                                    type="button"
                                    onClick={onGoToBatch}
                                    className="text-[11px] font-semibold text-[#2775CA] hover:underline"
                                >
                                    Switch to batch payouts →
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* ── STEP 2 & 3: REVIEW & SENDING FLOW ── */
                        <div key="review-view" data-send-review className="space-y-0">
                            {/* Header */}
                            <div id="sheet-review-header" className="relative flex items-center justify-center h-[40px]">
                                <button
                                    type="button"
                                    onClick={() => { if (!commitRef.current) void swapToView("compose", -1); }}
                                    disabled={sendingState !== "idle" || viewTransitioning}
                                    aria-label="Back"
                                    className="absolute left-0 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition"
                                >
                                    ‹
                                </button>
                                <span className="text-sm font-bold tracking-wide">Review</span>
                            </div>

                            {/* Unified Fixed-Height Stage (Review & Sending Hero occupy exact same container) */}
                            <div className="relative h-[236px] w-full">
                                {/* Top Amount & Chain View (Review Stage) */}
                                <div
                                    id="sheet-review-top"
                                    className="absolute inset-0 flex flex-col items-center justify-start pt-[6px] text-center"
                                >
                                    <div className="text-[46px] leading-[55px] font-semibold tracking-tight text-[#111827] dark:text-white">
                                        {displayUsdc(displayQuote?.amountUsdc || "0")} <small className="text-[18px] text-black/50 dark:text-white/50 font-semibold">USDC</small>
                                    </div>
                                    <div className="mt-[2px] text-[13px] leading-[16px] text-black/50 dark:text-white/50">
                                        ${displayUsdc(displayQuote?.amountUsdc || "0")}
                                    </div>

                                    {/* Participant Row: [Sender] ... [Network Logo] ... [Recipient] */}
                                    <div className="flex items-start justify-center gap-[6px] mt-[22px]">
                                        {/* Sender */}
                                        <div className="flex flex-col items-center w-[84px]">
                                            <SafeAvatar
                                                src={senderAvatarUrl}
                                                fallbackText={senderInfo?.alias || "You"}
                                                alt={senderInfo?.alias || "Your profile"}
                                                testId="send-sender-avatar"
                                                containerClassName="w-[44px] h-[44px] rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] flex items-center justify-center overflow-hidden mb-[6px]"
                                            />
                                            <span className="text-[11px] font-semibold text-black/60 dark:text-white/60 truncate w-full">
                                                {senderInfo?.alias || (senderInfo?.wallet ? formatShortAddress(senderInfo.wallet) : "You")}
                                            </span>
                                        </div>

                                        {/* Dashes + Network Logo + Dashes */}
                                        <div className="flex items-center gap-[6px] mt-[4px]">
                                            <div className="flex gap-[5px]">
                                                {[0, 1, 2, 3, 4, 5].map((i) => (
                                                    <i
                                                        key={i}
                                                        className="w-[3px] h-[3px] rounded-full bg-[#111827] dark:bg-[#FFFFF0] opacity-20"
                                                        style={{ animation: "pl 0.8s infinite", animationDelay: `calc(${i} * 55ms + 0s)` }}
                                                    />
                                                ))}
                                            </div>
                                            <div ref={smallLogoRef} className="shrink-0">
                                                <ChainLogo chain={currentNetwork.id} size={36} className="w-[36px] h-[36px] shrink-0" />
                                            </div>
                                            <div className="flex gap-[5px]">
                                                {[0, 1, 2, 3, 4, 5].map((i) => (
                                                    <i
                                                        key={i}
                                                        className="w-[3px] h-[3px] rounded-full bg-[#111827] dark:bg-[#FFFFF0] opacity-20"
                                                        style={{ animation: "pl 0.8s infinite", animationDelay: `calc(${i} * 55ms + 0.4s)` }}
                                                    />
                                                ))}
                                            </div>
                                        </div>

                                        {/* Recipient */}
                                        <div className="flex flex-col items-center w-[84px]">
                                            <SafeAvatar
                                                src={reviewTarget?.alias || reviewTarget?.hasAccount ? reviewTarget.profilePic : null}
                                                fallbackText={reviewTarget?.alias || "User"}
                                                walletFallback={!reviewTarget?.alias && !reviewTarget?.hasAccount}
                                                alt={reviewTarget?.alias || "Recipient profile"}
                                                testId="send-recipient-avatar"
                                                containerClassName="w-[44px] h-[44px] rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] flex items-center justify-center overflow-hidden mb-[6px]"
                                            />
                                            <span className="text-[11px] font-semibold text-black/60 dark:text-white/60 truncate w-full">
                                                {reviewTarget?.alias || formatShortAddress(sentResult?.recipientAddress || reviewTarget?.address || recipient)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Sending Hero Stage (Hidden until swipe committed, positioned directly over review) */}
                                <div
                                    id="sheet-sending-hero"
                                    className="absolute inset-0 flex flex-col items-center justify-start pt-[10px] text-center transition-opacity duration-300 pointer-events-none"
                                    style={{ opacity: sendingState === "idle" ? 0 : 1 }}
                                >
                                    <div id="sheet-hero-wrapper" className="relative w-[124px] h-[124px] mx-auto">
                                        {/* Arc Spin & Countdown Ring */}
                                        <svg className="absolute inset-0 w-[124px] h-[124px] -rotate-90" viewBox="0 0 124 124">
                                            <circle
                                                ref={arcRingRef}
                                                cx="62"
                                                cy="62"
                                                r="58"
                                                fill="none"
                                                stroke="#2775CA"
                                                strokeWidth="3"
                                                strokeLinecap="round"
                                                strokeDasharray="80 260"
                                                style={{ transformOrigin: "62px 62px", animation: "sp 1s linear infinite" }}
                                            />
                                            <circle
                                                ref={countdownCircleRef}
                                                cx="62"
                                                cy="62"
                                                r="58"
                                                fill="none"
                                                stroke="#111827"
                                                strokeWidth="3"
                                                strokeLinecap="round"
                                                className="dark:stroke-[#FFFFF0] opacity-0"
                                            />
                                        </svg>

                                        {/* Flying Network Logo: 84px by 84px */}
                                        <div ref={heroLogoRef} className="hl absolute left-5 top-5 w-[84px] h-[84px] flex items-center justify-center">
                                            <ChainLogo chain={selectedNetwork} size={84} className="w-[84px] h-[84px] shrink-0" />
                                        </div>

                                        {/* Green Success Disc: 84px by 84px, #30D158 with #0F2A17 checkmark */}
                                        <div
                                            ref={okDiscRef}
                                            className="ok absolute left-5 top-5 w-[84px] h-[84px] rounded-full bg-[#30D158] flex items-center justify-center opacity-0"
                                        >
                                            <svg width="84" height="84" viewBox="0 0 84 84" className="m-0">
                                                <path d="M26 44l11 11 21-24" fill="none" stroke="#0F2A17" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                    </div>

                                    <h2 ref={heroTitleRef} aria-label={sendingState === "success" ? "Sent" : "Sending"} className="text-[22px] leading-[26px] font-bold tracking-tight text-[#111827] dark:text-white mt-[14px] mb-[4px]">
                                        {Array.from("Sending…").map((c, i) => (
                                            <span key={i} className="inline-block whitespace-pre">{c}</span>
                                        ))}
                                    </h2>
                                    <p ref={heroSubRef} className="text-[13px] leading-[16px] text-black/50 dark:text-white/50 m-0">
                                        {arriveStatus === "delayed" ? <span className="send-receipt-reveal">Taking a little longer than usual. You can safely press Done — your transfer is on its way.</span> : <>{displayUsdc(displayQuote?.amountUsdc || "0")} USDC to {reviewTarget?.alias || formatShortAddress(sentResult?.recipientAddress || reviewTarget?.address || recipient)}</>}
                                    </p>
                                </div>
                                <p className="absolute inset-x-0 bottom-1.5 m-0 text-center text-[11px] leading-4 text-black/50 dark:text-white/50">
                                    Wallet debit: {displayQuote ? `${displayUsdc(displayQuote.totalDebitUsdc)} USDC` : "Awaiting estimate"}
                                    {displayQuote?.feeTreatment === "deducted" && ` · ${isArcRoute ? (displayQuote.feeLabel || "Fee") : "Platform fee"} deducted from amount`}
                                    {receiptVisible && displayQuote && <span data-testid="send-receipt-fee"> · {isArcRoute ? displayQuote.feeLabel : "Platform fee"}: {displayUsdc(displayQuote.feeUsdc)} USDC</span>}
                                </p>
                            </div>

                            {sendError && <p role="alert" className="text-xs text-red-600">{sendError}</p>}
                            {/* Details Card */}
                            <div data-send-details className="rounded-[18px] border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] px-[16px] py-[4px] text-[14px] divide-y divide-black/5 dark:divide-white/5">
                                <div className="flex justify-between items-center pt-1">
                                    <span className="text-black/50 dark:text-white/50">Address</span>
                                    <b className="font-mono text-black dark:text-white">{formatShortAddress(sentResult?.recipientAddress || reviewTarget?.address || recipient)}</b>
                                </div>
                                <div className="relative flex justify-between items-center pt-2">
                                    <div className={`send-fee-row flex w-full items-center justify-between ${receiptVisible && (sentResult?.explorerUrl || sentResult?.txHash) ? "is-replaced" : ""}`}>
                                        <span className="text-black/50 dark:text-white/50">{isArcRoute ? (displayQuote?.feeLabel || "Network fee") : "Platform fee"}</span>
                                        <b className="font-mono text-black dark:text-white">{displayQuote ? `${displayUsdc(displayQuote.feeUsdc)} USDC` : feeText}</b>
                                    </div>
                                    {receiptVisible && sentResult && (sentResult.explorerUrl || sentResult.txHash) && <a href={sentResult.explorerUrl || getExplorerTxUrl(sentResult.txHash)} target="_blank" rel="noopener noreferrer" className="send-receipt-reveal absolute inset-0 flex items-center justify-between text-sm font-semibold text-[#2775CA]"><span>View Receipt</span><span aria-hidden="true">↗</span></a>}
                                </div>
                                {isArcRoute && displayQuote?.nativeGasUsdc && <div className="flex justify-between items-center pt-2">
                                    <span className="text-black/50 dark:text-white/50">Wallet gas</span>
                                    <b className="font-mono">{displayUsdc(displayQuote.nativeGasUsdc)} USDC</b>
                                </div>}
                                <div className="flex justify-between items-center pt-2">
                                    <span className="text-black/50 dark:text-white/50">{isArcRoute ? "Transfer status" : "Arrives in"}</span>
                                    <b ref={arrivesBRef} id="sheet-arrives-label" className="font-mono text-black dark:text-white">
                                        {visibleArriveStatus === "arrived" ? (
                                            <span className="text-[#30D158] font-bold">{isArcRoute ? "Confirmed" : "Arrived"}</span>
                                        ) : visibleArriveStatus === "delayed" ? (
                                            <span className="text-[#4F86C6] font-semibold animate-pulse">{isArcRoute ? "Awaiting confirmation…" : "Arriving shortly…"}</span>
                                        ) : visibleArriveStatus === "failed" ? (
                                            <span className="text-[#EF4444] font-bold">Failed</span>
                                        ) : visibleArriveStatus === "counting" ? (
                                            isArcRoute ? <span>Confirming…</span> : <span>In <RollingNumber value={String(arriveCountdown ?? (arrivalEstimateSeconds(displayQuote?.arrival) || 10))} />s</span>
                                        ) : isArcRoute ? (
                                            <span>Ready to send</span>
                                        ) : (
                                            currentNetwork.estimatedTime || "About 15 minutes"
                                        )}
                                    </b>
                                </div>
                                <div className="flex justify-between items-center pt-2 font-bold">
                                    <span className="text-black/50 dark:text-white/50">Total received</span>
                                    <b className="font-mono text-[#2775CA] dark:text-[#6A8BE8]">{displayQuote ? displayUsdc(displayQuote.recipientUsdc) : "0"} USDC</b>
                                </div>
                            </div>

                            {sentResult?.status === "pending_attestation" && (
                                <p className="text-center text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-xl p-2.5">
                                    On its way. You can close this; it will arrive in about 15 minutes.
                                </p>
                            )}
                            {/* Swipe to Send Slider */}
                            <div
                                className="relative h-[58px] mt-[16px] rounded-full bg-[#D7E5F5] dark:bg-[#26364D] overflow-hidden select-none touch-none"
                                style={{ boxShadow: sendingState !== "idle" ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.12)" : undefined }}
                            >
                                <div
                                    ref={sliderFillRef}
                                    className="absolute left-0 top-0 bottom-0 w-[58px] rounded-full bg-[#2775CA]"
                                />
                                <div
                                    ref={sliderLabelRef}
                                    className="absolute inset-0 flex items-center justify-center font-semibold text-[15px] text-[#2775CA] dark:text-[#6A8BE8] pointer-events-none"
                                >
                                    Slide to send ››
                                </div>
                                <div
                                    ref={sliderButtonRef}
                                    className="absolute inset-0 flex items-center justify-center font-bold text-[16px] !text-white opacity-0 pointer-events-none"
                                >
                                    Confirming{[0, 1, 2].map(i => <span key={i} className="send-confirming-dot" style={{ animationDelay: `${i * .2}s` }}>.</span>)}
                                </div>
                                <button
                                    ref={sliderThumbRef}
                                    type="button"
                                    aria-label="Slide to send"
                                    disabled={sendingState !== "idle" || viewTransitioning}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            void handleCommitSend();
                                        }
                                    }}
                                    onClick={event => { if (event.detail === 0) void handleCommitSend(); }}
                                    className="absolute left-[5px] top-[5px] w-[48px] h-[48px] rounded-full bg-white dark:bg-[#FFFFF0] text-[#2775CA] flex items-center justify-center font-bold text-base shadow-md cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[#2775CA] focus-visible:outline-offset-[-2px]"
                                    style={{ animation: sendingState === "idle" ? "hl 1.8s infinite" : "none" }}
                                >
                                    <OutgoingTransactionIcon className="w-5 h-5 text-[#2775CA]" />
                                </button>
                                {doneReady && <button type="button" aria-label="Done" onClick={() => void handleClose()} className="absolute inset-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2775CA]" />}
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
