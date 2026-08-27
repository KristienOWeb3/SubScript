"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Link as LinkIcon,
    Copy,
    Check,
    RotateCw,
    Shield,
    AlertTriangle,
    QrCode,
    Sparkles,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface DmInviteManagerModalProps {
    open: boolean;
    onClose: () => void;
}

export default function DmInviteManagerModal({
    open,
    onClose,
}: DmInviteManagerModalProps) {
    const [loading, setLoading] = useState(false);
    const [inviteUrl, setInviteUrl] = useState("");
    const [enabled, setEnabled] = useState(true);
    const [tokenVersion, setTokenVersion] = useState(1);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [showRotateConfirm, setShowRotateConfirm] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [showQr, setShowQr] = useState(false);

    const loadInviteSettings = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/user/dm/invite");
            if (res.ok) {
                const data = await res.json();
                if (data.invite) {
                    setInviteUrl(data.invite.inviteUrl || "");
                    setEnabled(data.invite.enabled);
                    setTokenVersion(data.invite.tokenVersion);
                }
            } else {
                const data = await res.json();
                setError(data.error || "Failed to load invite link");
            }
        } catch (err: any) {
            setError(err.message || "Failed to load invite link");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadInviteSettings();
            setShowRotateConfirm(false);
            setShowQr(false);
        }
    }, [open]);

    const handleCopy = async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleToggleEnabled = async () => {
        setToggling(true);
        setError(null);
        try {
            const nextState = !enabled;
            const res = await fetch("/api/user/dm/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "toggle", enabled: nextState }),
            });
            const data = await res.json();
            if (res.ok && data.invite) {
                setEnabled(data.invite.enabled);
                setInviteUrl(data.invite.inviteUrl);
            } else {
                setError(data.error || "Failed to update invite settings");
            }
        } catch (err: any) {
            setError(err.message || "Failed to update invite settings");
        } finally {
            setToggling(false);
        }
    };

    const handleRotate = async () => {
        setRotating(true);
        setError(null);
        try {
            const res = await fetch("/api/user/dm/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "rotate" }),
            });
            const data = await res.json();
            if (res.ok && data.invite) {
                setInviteUrl(data.invite.inviteUrl);
                setTokenVersion(data.invite.tokenVersion);
                setEnabled(data.invite.enabled);
                setShowRotateConfirm(false);
            } else {
                setError(data.error || "Failed to rotate invite link");
            }
        } catch (err: any) {
            setError(err.message || "Failed to rotate invite link");
        } finally {
            setRotating(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            {/* Modal Content */}
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="dm-invite-title"
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                className="relative z-10 w-full max-w-lg rounded-3xl border border-black/10 bg-[#FFFFF0] text-black shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-black/10 px-6 py-4 bg-white/60">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA]">
                            <LinkIcon className="h-4 w-4" />
                        </div>
                        <div>
                            <h2 id="dm-invite-title" className="text-sm font-black uppercase tracking-tight text-[#111827]">My DM Invite Link</h2>
                            <p className="text-[11px] text-black/55">Shareable link for peers to request connections</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 text-black/40 hover:bg-black/5 hover:text-black transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Error Banner */}
                    {error && (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-300">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="space-y-4">
                            <div className="h-20 rounded-2xl border border-black/5 bg-white/70 p-4 animate-pulse space-y-2">
                                <div className="h-4 w-44 bg-black/10 rounded" />
                                <div className="h-3 w-60 bg-black/5 rounded" />
                            </div>
                            <div className="h-14 rounded-2xl border border-black/5 bg-white/70 p-3 animate-pulse" />
                        </div>
                    ) : (
                        <>
                            {/* Status Card */}
                            <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/80 p-4">
                                <div className="space-y-0.5">
                                    <p className="text-xs font-bold text-[#111827]">Accept incoming DM requests</p>
                                    <p className="text-[11px] text-black/55">
                                        {enabled
                                            ? "Anyone with your link can send you a connection request."
                                            : "Requests are paused. Existing connections remain active."}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={toggling}
                                    onClick={handleToggleEnabled}
                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        enabled ? "bg-[#2775CA]" : "bg-black/15"
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                            enabled ? "translate-x-5" : "translate-x-0"
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Link Box */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-bold text-black/70">Shareable Invite Link</span>
                                    <span className="text-[10px] text-black/40">Version {tokenVersion}</span>
                                </div>
                                <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white p-2 pl-3.5 shadow-sm">
                                    <input
                                        type="text"
                                        readOnly
                                        value={inviteUrl}
                                        className="w-full bg-transparent text-xs font-mono text-[#111827] focus:outline-none select-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="flex items-center gap-1.5 rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3.5 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-all shadow-sm"
                                    >
                                        {copied ? (
                                            <>
                                                <Check className="h-3.5 w-3.5" /> Copied
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-3.5 w-3.5" /> Copy
                                            </>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowQr((prev) => !prev)}
                                        className="flex items-center justify-center h-8 w-8 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 text-black/70 hover:text-black transition-all"
                                        title="View QR Code"
                                    >
                                        <QrCode className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* QR Code Reveal */}
                            <AnimatePresence>
                                {showQr && inviteUrl && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="flex flex-col items-center justify-center p-4 rounded-2xl border border-black/10 bg-white/60 space-y-3"
                                    >
                                        <div className="p-3 bg-white rounded-xl shadow-lg border border-black/5">
                                            <QRCodeSVG value={inviteUrl} size={150} level="M" />
                                        </div>
                                        <p className="text-[10px] text-black/50">Scan to open invite link</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Rotate Link Action */}
                            <div className="pt-2 border-t border-black/10">
                                {!showRotateConfirm ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowRotateConfirm(true)}
                                        className="flex items-center gap-2 text-xs font-bold text-black/55 hover:text-amber-600 transition-colors"
                                    >
                                        <RotateCw className="h-3.5 w-3.5" /> Rotate invite link
                                    </button>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, y: 5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 space-y-3"
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                            <div className="space-y-1">
                                                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Are you sure you want to rotate your link?</p>
                                                <p className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed">
                                                    Any previously shared invite links will immediately stop working and cannot be restored.
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-end gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowRotateConfirm(false)}
                                                className="rounded-xl border border-black/10 bg-black/5 px-3 py-1.5 text-[10px] font-bold text-black/70 hover:text-black transition-all"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={rotating}
                                                onClick={handleRotate}
                                                className="flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white transition-all disabled:opacity-50"
                                            >
                                                {rotating ? (
                                                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                ) : (
                                                    <>
                                                        <RotateCw className="h-3 w-3" /> Yes, Rotate Link
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
