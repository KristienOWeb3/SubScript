"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    MessageSquare,
    Send,
    CheckCircle2,
    AlertCircle,
    UserCheck,
    ArrowRight,
    Lock,
    Shield,
    Sparkles,
} from "lucide-react";
import Image from "next/image";

interface RecipientInfo {
    walletAddress: string;
    displayName: string;
    alias: string | null;
    profilePic: string | null;
}

interface InviteClientProps {
    token: string;
    initialValid: boolean;
    initialStatus: "VALID" | "REVOKED" | "DISABLED" | "INVALID";
    initialError: string | null;
    initialRecipient: RecipientInfo | null;
}

export default function InviteClient({
    token,
    initialValid,
    initialStatus,
    initialError,
    initialRecipient,
}: InviteClientProps) {
    const router = useRouter();
    const [recipient] = useState<RecipientInfo | null>(initialRecipient);
    const [isValid] = useState<boolean>(initialValid);
    const [status] = useState(initialStatus);
    const [errorMessage] = useState(initialError);

    const [userWallet, setUserWallet] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [checkingSession, setCheckingSession] = useState(true);

    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [requestSuccess, setRequestSuccess] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                if (res.ok) {
                    const data = await res.json();
                    if (data.loggedIn && data.wallet) {
                        setUserWallet(data.wallet.toLowerCase());
                        setUserRole(data.role || null);
                    }
                }
            } catch (err) {
                console.error("Failed to check session:", err);
            } finally {
                setCheckingSession(false);
            }
        };
        checkSession();
    }, []);

    const isSelf = Boolean(
        userWallet &&
        recipient &&
        userWallet.toLowerCase() === recipient.walletAddress.toLowerCase()
    );

    const handleSendRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userWallet) return;
        setSubmitting(true);
        setSubmitError(null);

        try {
            const res = await fetch("/api/user/dm/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inviteToken: token,
                    note: note.trim() || undefined,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to send connection request");
            }

            setRequestSuccess(true);
        } catch (err: any) {
            setSubmitError(err.message || "Failed to send connection request");
        } finally {
            setSubmitting(false);
        }
    };

    const currentPath = typeof window !== "undefined" ? window.location.pathname : `/dm/invite/${token}`;

    return (
        <div className="relative min-h-screen bg-[#080808] text-white flex flex-col items-center justify-center p-4 selection:bg-[#ccff00] selection:text-black">
            {/* Ambient background accents */}
            <div className="absolute top-1/4 -left-32 h-96 w-96 rounded-full bg-[#ccff00]/5 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-1/4 -right-32 h-96 w-96 rounded-full bg-[#00d2b4]/5 blur-[120px] pointer-events-none" />

            <div className="relative z-10 w-full max-w-md">
                {/* Brand Header */}
                <div className="flex items-center justify-center gap-2 mb-6">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                        <MessageSquare className="h-5 w-5 text-[#ccff00]" />
                    </div>
                    <span className="text-sm font-black tracking-wider uppercase text-white/90">SubScript DMs</span>
                </div>

                {!isValid || !recipient ? (
                    /* Invalid / Expired Link Card */
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-2xl text-center shadow-2xl space-y-6"
                    >
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            <AlertCircle className="h-7 w-7" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-xl font-bold text-white">Invite link unavailable</h2>
                            <p className="text-xs text-white/50 leading-relaxed">
                                {status === "REVOKED"
                                    ? "This invite link has been rotated or updated by the account owner."
                                    : status === "DISABLED"
                                    ? "This user is currently not accepting new DM connection requests."
                                    : errorMessage || "This invite link is invalid or has expired."}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => router.push("/")}
                            className="w-full rounded-2xl bg-white/10 hover:bg-white/15 px-4 py-3 text-xs font-bold text-white transition-all"
                        >
                            Return to SubScript
                        </button>
                    </motion.div>
                ) : requestSuccess ? (
                    /* Success State Card */
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-3xl border border-[#ccff00]/20 bg-white/[0.03] p-8 backdrop-blur-2xl text-center shadow-2xl space-y-6"
                    >
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ccff00]/10 border border-[#ccff00]/30 text-[#ccff00]">
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-xl font-black uppercase tracking-tight text-white">Request Sent</h2>
                            <p className="text-xs text-white/50 leading-relaxed">
                                Your connection request was sent to <span className="text-[#ccff00] font-bold">{recipient.displayName}</span>. Once accepted, your DM thread will activate automatically.
                            </p>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => router.push("/user?tab=inbox")}
                                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#ccff00] hover:bg-[#b8e600] px-5 py-3.5 text-xs font-black uppercase tracking-wider text-black transition-all shadow-[0_0_20px_rgba(204,255,0,0.2)]"
                            >
                                Open My DM Inbox <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    </motion.div>
                ) : (
                    /* Active Invite Connection Card */
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 backdrop-blur-2xl shadow-2xl space-y-6"
                    >
                        {/* Profile Header */}
                        <div className="flex flex-col items-center text-center space-y-3">
                            <div className="relative">
                                {recipient.profilePic ? (
                                    <div className="relative h-20 w-20 overflow-hidden rounded-full border-2 border-[#ccff00]/50 shadow-[0_0_25px_rgba(204,255,0,0.15)]">
                                        <Image
                                            src={recipient.profilePic}
                                            alt={recipient.displayName}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#ccff00]/30 bg-[#ccff00]/10 text-2xl font-black text-[#ccff00] shadow-[0_0_25px_rgba(204,255,0,0.1)]">
                                        {recipient.displayName.slice(0, 2).toUpperCase()}
                                    </div>
                                )}
                                <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#080808] border border-white/10">
                                    <Sparkles className="h-3.5 w-3.5 text-[#ccff00]" />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center justify-center gap-1.5">
                                    <h1 className="text-lg font-black tracking-tight text-white">{recipient.displayName}</h1>
                                </div>
                                <p className="text-[11px] font-mono text-white/40">
                                    {recipient.walletAddress.slice(0, 6)}...{recipient.walletAddress.slice(-4)}
                                </p>
                            </div>

                            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/60">
                                <Shield className="h-3 w-3 text-[#ccff00]" />
                                Verified SubScript User
                            </div>
                        </div>

                        {/* Status / Actions Container */}
                        {checkingSession ? (
                            <div className="py-8 flex justify-center items-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#ccff00] border-t-transparent" />
                            </div>
                        ) : isSelf ? (
                            /* Self Invite Link Notice */
                            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center space-y-3">
                                <p className="text-xs text-white/60">This is your personal shareable invite link.</p>
                                <button
                                    type="button"
                                    onClick={() => router.push("/user?tab=inbox")}
                                    className="w-full rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2.5 text-xs font-bold text-white transition-all"
                                >
                                    Go to DM Dashboard
                                </button>
                            </div>
                        ) : !userWallet ? (
                            /* Guest / Logged-Out CTA */
                            <div className="space-y-4 pt-2">
                                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center space-y-2">
                                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/60">
                                        <Lock className="h-4 w-4" />
                                    </div>
                                    <p className="text-xs font-bold text-white">Sign in to connect</p>
                                    <p className="text-[11px] text-white/45 leading-relaxed">
                                        Sign in with your wallet or email to send a direct message connection request to this user.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => router.push(`/signup?role=user&next=${encodeURIComponent(currentPath)}`)}
                                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#ccff00] hover:bg-[#b8e600] px-5 py-3.5 text-xs font-black uppercase tracking-wider text-black transition-all shadow-[0_0_20px_rgba(204,255,0,0.15)]"
                                >
                                    <UserCheck className="h-4 w-4" /> Connect with SubScript
                                </button>
                            </div>
                        ) : (
                            /* Authenticated Connection Form */
                            <form onSubmit={handleSendRequest} className="space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px]">
                                        <label htmlFor="invite-note" className="font-bold text-white/70">
                                            Introductory Note <span className="text-white/30 font-normal">(Optional)</span>
                                        </label>
                                        <span className={`text-[10px] ${note.length > 260 ? "text-amber-400 font-bold" : "text-white/35"}`}>
                                            {note.length}/280
                                        </span>
                                    </div>
                                    <textarea
                                        id="invite-note"
                                        rows={3}
                                        maxLength={280}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder={`Hi ${recipient.displayName}, let's connect on SubScript!`}
                                        className="w-full rounded-2xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white placeholder-white/25 focus:border-[#ccff00] focus:outline-none focus:ring-1 focus:ring-[#ccff00] transition-all resize-none"
                                    />
                                </div>

                                <AnimatePresence>
                                    {submitError && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-300 flex items-start gap-2"
                                        >
                                            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                                            <span>{submitError}</span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#ccff00] hover:bg-[#b8e600] disabled:opacity-50 px-5 py-3.5 text-xs font-black uppercase tracking-wider text-black transition-all shadow-[0_0_20px_rgba(204,255,0,0.15)]"
                                >
                                    {submitting ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                                    ) : (
                                        <>
                                            <Send className="h-4 w-4" /> Send DM Request
                                        </>
                                    )}
                                </button>
                            </form>
                        )}
                    </motion.div>
                )}
            </div>
        </div>
    );
}
