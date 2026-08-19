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
} from "@/components/icons";
import PeerAvatar from "@/components/dashboard/PeerAvatar";

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
        /* Matches the shell of /pay/[id], the other public page a stranger lands on from a link.
           This page was still on the retired dark-glass design — #080808 with a lime accent — so
           following an invite dropped the user from the cream DM surfaces onto something that
           looked like a different product. */
        <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#FFFFF0] p-4 font-sans text-black selection:bg-[#2775CA]/20 selection:text-black sm:p-6">
            <div className="relative z-10 w-full max-w-md">
                {/* Brand Header */}
                <div className="mb-6 flex items-center justify-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white shadow-sm">
                        <MessageSquare className="h-5 w-5 text-[#2775CA]" />
                    </div>
                    <span className="text-sm font-black uppercase tracking-wider text-[#111827]">SubScript DMs</span>
                </div>

                {!isValid || !recipient ? (
                    /* Invalid / Expired Link Card */
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6 rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm"
                    >
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-100 text-amber-700">
                            <AlertCircle className="h-7 w-7" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-xl font-bold text-[#111827]">Invite link unavailable</h2>
                            <p className="text-xs leading-relaxed text-black/60">
                                {status === "REVOKED"
                                    ? "The account owner has since rotated this invite link."
                                    : status === "DISABLED"
                                    ? "This person isn't taking new DM requests right now."
                                    : errorMessage || "This invite link is invalid or has expired."}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => router.push("/")}
                            className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-xs font-bold text-[#111827] transition-colors hover:bg-black/[0.03]"
                        >
                            Back to SubScript
                        </button>
                    </motion.div>
                ) : requestSuccess ? (
                    /* Success State Card */
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm"
                    >
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-xl font-black uppercase tracking-tight text-[#111827]">Request sent</h2>
                            <p className="text-xs leading-relaxed text-black/60">
                                <span className="font-bold text-[#111827]">{recipient.displayName}</span> has your request. Your DM thread opens as soon as they accept.
                            </p>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => router.push("/user?tab=inbox")}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] px-5 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-[#1f62ab]"
                            >
                                Open my DM inbox <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    </motion.div>
                ) : (
                    /* Active Invite Connection Card */
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6 rounded-3xl border border-black/15 bg-white p-6 shadow-sm sm:p-8"
                    >
                        {/* Profile Header */}
                        <div className="flex flex-col items-center space-y-3 text-center">
                            {/* PeerAvatar rather than next/image: profile pictures are arbitrary
                                user-supplied URLs and next/image blocks every host not declared in
                                images.remotePatterns, of which there are none — so the invited
                                person's picture never loaded here either. */}
                            <PeerAvatar
                                src={recipient.profilePic}
                                name={recipient.displayName}
                                className="h-20 w-20"
                                fallbackClassName="bg-[#2775CA]/10 border-[#2775CA]/20 text-2xl text-[#2775CA]"
                            />

                            <div className="space-y-1">
                                <h1 className="text-lg font-black tracking-tight text-[#111827]">{recipient.displayName}</h1>
                                <p className="font-mono text-[11px] text-black/45">
                                    {recipient.walletAddress.slice(0, 6)}...{recipient.walletAddress.slice(-4)}
                                </p>
                            </div>

                            <div className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[10px] font-semibold text-black/60">
                                <Shield className="h-3 w-3 text-[#2775CA]" />
                                Verified SubScript user
                            </div>
                        </div>

                        {/* Status / Actions Container */}
                        {checkingSession ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2775CA] border-t-transparent" />
                            </div>
                        ) : isSelf ? (
                            /* Self Invite Link Notice */
                            <div className="space-y-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-center">
                                <p className="text-xs text-black/60">This is your own invite link — share it to get requests.</p>
                                <button
                                    type="button"
                                    onClick={() => router.push("/user?tab=inbox")}
                                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-bold text-[#111827] transition-colors hover:bg-black/[0.03]"
                                >
                                    Go to my DMs
                                </button>
                            </div>
                        ) : !userWallet ? (
                            /* Guest / Logged-Out CTA */
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-center">
                                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white text-black/60">
                                        <Lock className="h-4 w-4" />
                                    </div>
                                    <p className="text-xs font-bold text-[#111827]">Sign in to connect</p>
                                    <p className="text-[11px] leading-relaxed text-black/55">
                                        Sign in with your wallet or email to send {recipient.displayName} a DM request.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => router.push(`/signup?role=user&next=${encodeURIComponent(currentPath)}`)}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] px-5 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-[#1f62ab]"
                                >
                                    <UserCheck className="h-4 w-4" /> Continue with SubScript
                                </button>
                            </div>
                        ) : (
                            /* Authenticated Connection Form */
                            <form onSubmit={handleSendRequest} className="space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px]">
                                        <label htmlFor="invite-note" className="font-bold text-black/70">
                                            Add a note <span className="font-normal text-black/40">(optional)</span>
                                        </label>
                                        <span className={`text-[10px] ${note.length > 260 ? "font-bold text-amber-700" : "text-black/40"}`}>
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
                                        className="w-full resize-none rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-xs text-black transition-colors placeholder:text-black/30 focus:border-[#2775CA] focus:outline-none"
                                    />
                                </div>

                                <AnimatePresence>
                                    {submitError && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700"
                                        >
                                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                                            <span>{submitError}</span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] px-5 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-[#1f62ab] disabled:opacity-50"
                                >
                                    {submitting ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    ) : (
                                        <>
                                            <Send className="h-4 w-4" /> Send DM request
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
