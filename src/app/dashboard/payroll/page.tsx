"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useSignTypedData } from "wagmi";
import Link from "next/link";
import {
    ArrowLeft, Plus, Pause, Play, Trash2, Users, Calendar,
    Shield, ShieldOff, Loader2, CheckCircle, AlertTriangle,
    DollarSign, Clock, Building2, Lock
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const ARC_TESTNET_CHAIN_ID = 5042002;

/* Frequency presets in days */
const FREQUENCY_OPTIONS = [
    { label: "Weekly", value: 7 },
    { label: "Bi-weekly", value: 14 },
    { label: "Monthly", value: 30 },
    { label: "Custom", value: 0 },
] as const;

/* EIP-712 typed data types for Permit2 */
const PERMIT2_TYPES = {
    PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
    ],
} as const;

/* Permit2 EIP-712 domain on Arc Testnet */
const PERMIT2_DOMAIN = {
    name: "Permit2",
    chainId: ARC_TESTNET_CHAIN_ID,
    verifyingContract: PERMIT2_ADDRESS,
} as const;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Recipient {
    id: string;
    employeeWallet: string;
    salaryAmountUsdc: string;
}

interface PayrollCampaign {
    id: string;
    title: string;
    frequencyDays: number;
    nextPayday: string;
    isShielded: boolean;
    status: "ACTIVE" | "PAUSED";
    permit2Signature: string | null;
    recipients: Array<{
        id: string;
        employeeWallet: string;
        salaryAmountUsdc: number;
    }>;
}

interface ToastState {
    visible: boolean;
    message: string;
    type: "success" | "error" | "info";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatUsdc(microUsdc: number): string {
    return (microUsdc / 1_000_000).toFixed(2);
}

function generateTempId(): string {
    return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function frequencyLabel(days: number): string {
    if (days === 7) return "Weekly";
    if (days === 14) return "Bi-weekly";
    if (days === 30) return "Monthly";
    return `Every ${days} days`;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function PayrollPage() {
    /* ----- wallet state ----- */
    const { address, isConnected } = useAccount();
    const { signTypedDataAsync } = useSignTypedData();

    /* ----- page state ----- */
    const [isMounted, setIsMounted] = useState(false);
    const [campaigns, setCampaigns] = useState<PayrollCampaign[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [merchantTier, setMerchantTier] = useState<string | null>(null);
    const [isLoadingTier, setIsLoadingTier] = useState(true);

    const pageIsLoading = isLoading || isLoadingTier;

    /* ----- toast ----- */
    const [toast, setToast] = useState<ToastState>({ visible: false, message: "", type: "info" });

    /* ----- create form state ----- */
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [formTitle, setFormTitle] = useState("");
    const [formFrequencyPreset, setFormFrequencyPreset] = useState(7);
    const [formCustomDays, setFormCustomDays] = useState("");
    const [formShielded, setFormShielded] = useState(false);
    const [formRecipients, setFormRecipients] = useState<Recipient[]>([
        { id: generateTempId(), employeeWallet: "", salaryAmountUsdc: "" },
    ]);
    const [permit2Sig, setPermit2Sig] = useState<string | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    /* ----- action-in-progress trackers ----- */
    const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

    /* ------------------------------------------------------------------ */
    /*  Mount guard                                                        */
    /* ------------------------------------------------------------------ */

    useEffect(() => {
        setIsMounted(true);
    }, []);

    /* ------------------------------------------------------------------ */
    /*  Toast helper                                                       */
    /* ------------------------------------------------------------------ */

    const showToast = useCallback((message: string, type: ToastState["type"] = "info") => {
        setToast({ visible: true, message, type });
        setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 4000);
    }, []);

    /* ------------------------------------------------------------------ */
    /*  Fetch campaigns                                                    */
    /* ------------------------------------------------------------------ */

    const fetchCampaigns = useCallback(async () => {
        if (!address) return;
        try {
            setIsLoading(true);
            setLoadError(null);
            const res = await fetch("/api/merchant/payroll");
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed to load campaigns (${res.status})`);
            }
            const data = await res.json();
            setCampaigns(data.campaigns ?? []);
        } catch (err: any) {
            setLoadError(err.message || "Unknown error loading campaigns");
        } finally {
            setIsLoading(false);
        }
    }, [address]);

    const fetchTier = useCallback(async () => {
        if (!address) return;
        try {
            setIsLoadingTier(true);
            const res = await fetch(`/api/merchant/tier?address=${address}`);
            if (res.ok) {
                const tierData = await res.json();
                const tierStr = tierData.tier === 1 ? "PREMIUM" : "FREE";
                setMerchantTier(tierStr);
            } else {
                setMerchantTier("FREE");
            }
        } catch (err) {
            console.error("Failed to fetch merchant tier:", err);
            setMerchantTier("FREE");
        } finally {
            setIsLoadingTier(false);
        }
    }, [address]);

    useEffect(() => {
        if (isMounted && address) {
            fetchCampaigns();
            fetchTier();
        }
    }, [isMounted, address, fetchCampaigns, fetchTier]);

    /* ------------------------------------------------------------------ */
    /*  Permit2 signing                                                    */
    /* ------------------------------------------------------------------ */

    const handleSignPermit2 = async () => {
        if (!address) return;
        setIsSigning(true);
        try {
            /* Compute total payroll in micro-USDC */
            let totalMicro = BigInt(0);
            for (const r of formRecipients) {
                const parsed = parseFloat(r.salaryAmountUsdc);
                if (!isNaN(parsed) && parsed > 0) {
                    totalMicro += BigInt(Math.round(parsed * 1_000_000));
                }
            }

            if (totalMicro === BigInt(0)) {
                showToast("Add at least one recipient with a salary amount", "error");
                setIsSigning(false);
                return;
            }

            /* Approve 100x total for recurring usage headroom */
            const approveAmount = totalMicro * BigInt(100);

            /* 30-day expiration */
            const expiration = Math.floor(Date.now() / 1000) + 86400 * 30;
            /* 24-hour sig deadline */
            const sigDeadline = Math.floor(Date.now() / 1000) + 86400;

            const signature = await signTypedDataAsync({
                domain: PERMIT2_DOMAIN,
                types: PERMIT2_TYPES,
                primaryType: "PermitSingle",
                message: {
                    details: {
                        token: USDC_ADDRESS,
                        amount: approveAmount,
                        expiration: expiration,
                        nonce: 0,
                    },
                    spender: address,
                    sigDeadline: BigInt(sigDeadline),
                },
            });

            setPermit2Sig(signature);
            showToast("Permit2 signature captured successfully", "success");
        } catch (err: any) {
            showToast(err?.shortMessage || err?.message || "Signing failed", "error");
        } finally {
            setIsSigning(false);
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Create campaign                                                    */
    /* ------------------------------------------------------------------ */

    const handleCreateCampaign = async () => {
        if (!address) return;
        if (!formTitle.trim()) {
            showToast("Campaign title is required", "error");
            return;
        }
        const frequencyDays = formFrequencyPreset === 0
            ? parseInt(formCustomDays, 10)
            : formFrequencyPreset;

        if (!frequencyDays || frequencyDays < 1) {
            showToast("Frequency must be at least 1 day", "error");
            return;
        }

        /* Validate recipients */
        const validRecipients = formRecipients.filter(
            (r) => r.employeeWallet.trim() && parseFloat(r.salaryAmountUsdc) > 0
        );
        if (validRecipients.length === 0) {
            showToast("Add at least one recipient with a wallet and salary", "error");
            return;
        }
        if (!permit2Sig) {
            showToast("Please sign the Permit2 approval first", "error");
            return;
        }

        setIsSubmitting(true);
        try {
            const body = {
                title: formTitle.trim(),
                frequencyDays,
                isShielded: formShielded,
                permit2Signature: permit2Sig,
                recipients: validRecipients.map((r) => ({
                    employeeWallet: r.employeeWallet.trim(),
                    salaryAmountUsdc: Math.round(parseFloat(r.salaryAmountUsdc) * 1_000_000),
                })),
            };

            const res = await fetch("/api/merchant/payroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to create campaign");
            }

            showToast("Payroll campaign created successfully", "success");
            resetCreateForm();
            fetchCampaigns();
        } catch (err: any) {
            showToast(err.message || "Failed to create campaign", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Toggle pause / resume                                              */
    /* ------------------------------------------------------------------ */

    const handleToggleStatus = async (campaign: PayrollCampaign) => {
        setTogglingIds((prev) => new Set(prev).add(campaign.id));
        try {
            const newStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
            const res = await fetch("/api/merchant/payroll", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: campaign.id, status: newStatus }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to update campaign");
            }

            setCampaigns((prev) =>
                prev.map((c) => (c.id === campaign.id ? { ...c, status: newStatus } : c))
            );
            showToast(
                newStatus === "ACTIVE" ? "Campaign resumed" : "Campaign paused",
                "success"
            );
        } catch (err: any) {
            showToast(err.message || "Failed to toggle campaign", "error");
        } finally {
            setTogglingIds((prev) => {
                const next = new Set(prev);
                next.delete(campaign.id);
                return next;
            });
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Delete campaign                                                    */
    /* ------------------------------------------------------------------ */

    const handleDelete = async (id: string) => {
        setDeletingIds((prev) => new Set(prev).add(id));
        try {
            const res = await fetch(`/api/merchant/payroll?id=${id}`, { method: "DELETE" });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to delete campaign");
            }

            setCampaigns((prev) => prev.filter((c) => c.id !== id));
            showToast("Campaign deleted", "success");
        } catch (err: any) {
            showToast(err.message || "Failed to delete campaign", "error");
        } finally {
            setDeletingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Recipient row helpers                                              */
    /* ------------------------------------------------------------------ */

    const addRecipientRow = () => {
        setFormRecipients((prev) => [
            ...prev,
            { id: generateTempId(), employeeWallet: "", salaryAmountUsdc: "" },
        ]);
    };

    const removeRecipientRow = (id: string) => {
        setFormRecipients((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((r) => r.id !== id);
        });
    };

    const updateRecipient = (id: string, field: keyof Omit<Recipient, "id">, value: string) => {
        setFormRecipients((prev) =>
            prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
        );
    };

    /* ------------------------------------------------------------------ */
    /*  Reset create form                                                  */
    /* ------------------------------------------------------------------ */

    const resetCreateForm = () => {
        setShowCreateForm(false);
        setFormTitle("");
        setFormFrequencyPreset(7);
        setFormCustomDays("");
        setFormShielded(false);
        setFormRecipients([{ id: generateTempId(), employeeWallet: "", salaryAmountUsdc: "" }]);
        setPermit2Sig(null);
    };

    /* ------------------------------------------------------------------ */
    /*  Computed values                                                    */
    /* ------------------------------------------------------------------ */

    const formTotalUsdc = formRecipients.reduce((sum, r) => {
        const val = parseFloat(r.salaryAmountUsdc);
        return sum + (isNaN(val) ? 0 : val);
    }, 0);

    /* ------------------------------------------------------------------ */
    /*  Inline Styles                                                      */
    /* ------------------------------------------------------------------ */

    const styles = {
        page: {
            background: "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)",
            minHeight: "100vh",
            color: "white",
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        } as React.CSSProperties,

        container: {
            maxWidth: "1100px",
            margin: "0 auto",
            padding: "32px 24px",
        } as React.CSSProperties,

        card: {
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            backdropFilter: "blur(24px)",
            padding: "24px",
            marginBottom: "20px",
        } as React.CSSProperties,

        cardCompact: {
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            backdropFilter: "blur(24px)",
            padding: "20px",
        } as React.CSSProperties,

        activeBadge: {
            background: "rgba(16, 185, 129, 0.15)",
            color: "#34d399",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "20px",
            padding: "4px 12px",
            fontSize: "12px",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
        } as React.CSSProperties,

        pausedBadge: {
            background: "rgba(245, 158, 11, 0.15)",
            color: "#fbbf24",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: "20px",
            padding: "4px 12px",
            fontSize: "12px",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
        } as React.CSSProperties,

        primaryBtn: {
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            border: "none",
            borderRadius: "10px",
            color: "white",
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            transition: "opacity 0.2s",
        } as React.CSSProperties,

        secondaryBtn: {
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            color: "rgba(255, 255, 255, 0.8)",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "background 0.2s",
        } as React.CSSProperties,

        dangerBtn: {
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "8px",
            color: "#f87171",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "background 0.2s",
        } as React.CSSProperties,

        input: {
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            color: "white",
            padding: "10px 14px",
            fontSize: "14px",
            width: "100%",
            outline: "none",
            transition: "border-color 0.2s",
        } as React.CSSProperties,

        select: {
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            color: "white",
            padding: "10px 14px",
            fontSize: "14px",
            width: "100%",
            outline: "none",
            cursor: "pointer",
            appearance: "none" as const,
        } as React.CSSProperties,

        label: {
            fontSize: "13px",
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.6)",
            marginBottom: "6px",
            display: "block",
        } as React.CSSProperties,

        skeletonBlock: {
            background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)",
            backgroundSize: "200% 100%",
            borderRadius: "8px",
            animation: "shimmer 1.5s ease-in-out infinite",
        } as React.CSSProperties,

        backLink: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            color: "rgba(255, 255, 255, 0.6)",
            textDecoration: "none",
            fontSize: "14px",
            fontWeight: 500,
            marginBottom: "24px",
            transition: "color 0.2s",
        } as React.CSSProperties,

        shieldedToggle: {
            display: "flex",
            alignItems: "center",
            gap: "12px",
            cursor: "pointer",
            padding: "12px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.02)",
            transition: "background 0.2s, border-color 0.2s",
        } as React.CSSProperties,
    };

    /* ------------------------------------------------------------------ */
    /*  Render: not yet mounted                                            */
    /* ------------------------------------------------------------------ */

    if (!isMounted) {
        return (
            <div style={styles.page}>
                <div style={styles.container}>
                    <div style={{ ...styles.skeletonBlock, height: "40px", width: "200px", marginBottom: "32px" }} />
                    <div style={{ ...styles.skeletonBlock, height: "160px", marginBottom: "16px" }} />
                    <div style={{ ...styles.skeletonBlock, height: "160px" }} />
                </div>
                <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
            </div>
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Render: not connected                                              */
    /* ------------------------------------------------------------------ */

    if (!isConnected || !address) {
        return (
            <div style={styles.page}>
                <div style={styles.container}>
                    <Link href="/dashboard" style={styles.backLink}>
                        <ArrowLeft size={16} />
                        Back to Dashboard
                    </Link>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ ...styles.card, textAlign: "center", padding: "60px 24px" }}
                    >
                        <Building2 size={48} style={{ color: "rgba(255,255,255,0.2)", marginBottom: "16px" }} />
                        <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>
                            Connect Your Wallet
                        </h2>
                        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px" }}>
                            Please connect your wallet to manage payroll campaigns.
                        </p>
                    </motion.div>
                </div>
            </div>
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Render: main page                                                  */
    /* ------------------------------------------------------------------ */

    return (
        <div style={styles.page}>
            {/* Shimmer animation keyframes */}
            <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>

            {/* Toast notification */}
            <AnimatePresence>
                {toast.visible && (
                    <motion.div
                        initial={{ opacity: 0, y: -40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -40 }}
                        style={{
                            position: "fixed",
                            top: "24px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 9999,
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "12px 20px",
                            borderRadius: "12px",
                            fontSize: "14px",
                            fontWeight: 500,
                            backdropFilter: "blur(16px)",
                            background:
                                toast.type === "success"
                                    ? "rgba(16, 185, 129, 0.2)"
                                    : toast.type === "error"
                                    ? "rgba(239, 68, 68, 0.2)"
                                    : "rgba(99, 102, 241, 0.2)",
                            border: `1px solid ${
                                toast.type === "success"
                                    ? "rgba(16, 185, 129, 0.4)"
                                    : toast.type === "error"
                                    ? "rgba(239, 68, 68, 0.4)"
                                    : "rgba(99, 102, 241, 0.4)"
                            }`,
                            color:
                                toast.type === "success"
                                    ? "#34d399"
                                    : toast.type === "error"
                                    ? "#f87171"
                                    : "#a5b4fc",
                        }}
                    >
                        {toast.type === "success" && <CheckCircle size={16} />}
                        {toast.type === "error" && <AlertTriangle size={16} />}
                        {toast.message}
                    </motion.div>
                )}
            </AnimatePresence>

            <div style={styles.container}>
                {/* Back link */}
                <Link href="/dashboard" style={styles.backLink}>
                    <ArrowLeft size={16} />
                    Back to Dashboard
                </Link>

                <div style={{ position: "relative" }}>
                    {/* Liquid Glass Lock Overlay for Standard/Free Tier */}
                    {!pageIsLoading && merchantTier === "FREE" && (
                        <div style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 50,
                            background: "rgba(10, 10, 15, 0.75)",
                            backdropFilter: "blur(16px)",
                            borderRadius: "16px",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "60px 24px",
                            textAlign: "center",
                            minHeight: "400px"
                        }}>
                            <div style={{
                                width: "64px",
                                height: "64px",
                                borderRadius: "50%",
                                background: "rgba(139, 92, 246, 0.15)",
                                border: "1px solid rgba(139, 92, 246, 0.3)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: "20px"
                            }}>
                                <Lock size={28} style={{ color: "#a5b4fc" }} />
                            </div>
                            <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "12px", color: "white" }}>
                                Premium Feature Locked
                            </h2>
                            <p style={{
                                color: "rgba(255,255,255,0.6)",
                                fontSize: "15px",
                                maxWidth: "480px",
                                marginBottom: "28px",
                                lineHeight: "1.6"
                            }}>
                                Institutional Payroll and automated recurring batch payouts are premium features. Upgrade your merchant account to premium to unlock streaming salary payouts to your team.
                            </p>
                            <Link
                                href="/dashboard?upgrade=true"
                                style={{
                                    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                                    borderRadius: "10px",
                                    color: "white",
                                    padding: "12px 28px",
                                    fontSize: "15px",
                                    fontWeight: 600,
                                    textDecoration: "none",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    boxShadow: "0 4px 20px rgba(99, 102, 241, 0.3)",
                                    transition: "transform 0.2s"
                                }}
                            >
                                Upgrade to Premium
                            </Link>
                        </div>
                    )}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "28px",
                        flexWrap: "wrap",
                        gap: "16px",
                    }}
                >
                    <div>
                        <h1 style={{
                            fontSize: "28px",
                            fontWeight: 700,
                            margin: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                        }}>
                            <Building2 size={28} style={{ color: "#8b5cf6" }} />
                            Institutional Payroll
                        </h1>
                        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", marginTop: "4px" }}>
                            Automate recurring salary payments to your team
                        </p>
                    </div>

                    <button
                        style={styles.primaryBtn}
                        onClick={() => setShowCreateForm((prev) => !prev)}
                    >
                        <Plus size={16} />
                        {showCreateForm ? "Cancel" : "New Campaign"}
                    </button>
                </motion.div>

                {/* ============================================================ */}
                {/*  Create Campaign Form                                        */}
                {/* ============================================================ */}
                <AnimatePresence>
                    {showCreateForm && (
                        <motion.div
                            key="create-form"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.35 }}
                            style={{ overflow: "hidden", marginBottom: "24px" }}
                        >
                            <div style={{
                                ...styles.card,
                                border: "1px solid rgba(99, 102, 241, 0.2)",
                            }}>
                                <h3 style={{
                                    fontSize: "18px",
                                    fontWeight: 600,
                                    marginTop: 0,
                                    marginBottom: "20px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }}>
                                    <Plus size={18} style={{ color: "#8b5cf6" }} />
                                    Create Payroll Campaign
                                </h3>

                                {/* Title */}
                                <div style={{ marginBottom: "16px" }}>
                                    <label style={styles.label}>Campaign Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Engineering Team - Monthly"
                                        value={formTitle}
                                        onChange={(e) => setFormTitle(e.target.value)}
                                        style={styles.input}
                                    />
                                </div>

                                {/* Frequency + Shielded row */}
                                <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: "16px",
                                    marginBottom: "16px",
                                }}>
                                    {/* Frequency */}
                                    <div>
                                        <label style={styles.label}>Pay Frequency</label>
                                        <select
                                            value={formFrequencyPreset}
                                            onChange={(e) => setFormFrequencyPreset(Number(e.target.value))}
                                            style={styles.select}
                                        >
                                            {FREQUENCY_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value} style={{ background: "#1a1a2e" }}>
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                        {formFrequencyPreset === 0 && (
                                            <input
                                                type="number"
                                                placeholder="Days between payouts"
                                                value={formCustomDays}
                                                onChange={(e) => setFormCustomDays(e.target.value)}
                                                min={1}
                                                style={{ ...styles.input, marginTop: "8px" }}
                                            />
                                        )}
                                    </div>

                                    {/* Shielded toggle */}
                                    <div>
                                        <label style={styles.label}>Privacy Mode</label>
                                        <div
                                            style={{
                                                ...styles.shieldedToggle,
                                                borderColor: formShielded
                                                    ? "rgba(99, 102, 241, 0.4)"
                                                    : "rgba(255, 255, 255, 0.08)",
                                                background: formShielded
                                                    ? "rgba(99, 102, 241, 0.08)"
                                                    : "rgba(255, 255, 255, 0.02)",
                                            }}
                                            onClick={() => setFormShielded((prev) => !prev)}
                                        >
                                            {formShielded ? (
                                                <Shield size={18} style={{ color: "#8b5cf6" }} />
                                            ) : (
                                                <ShieldOff size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
                                            )}
                                            <span style={{
                                                fontSize: "13px",
                                                color: formShielded ? "#a5b4fc" : "rgba(255,255,255,0.5)",
                                            }}>
                                                {formShielded ? "Shielded (Private)" : "Standard (Public)"}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Recipients table */}
                                <div style={{ marginBottom: "20px" }}>
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: "10px",
                                    }}>
                                        <label style={{ ...styles.label, marginBottom: 0 }}>
                                            Recipients ({formRecipients.length})
                                        </label>
                                        <button
                                            type="button"
                                            onClick={addRecipientRow}
                                            style={{
                                                ...styles.secondaryBtn,
                                                fontSize: "12px",
                                                padding: "6px 12px",
                                            }}
                                        >
                                            <Plus size={14} />
                                            Add Row
                                        </button>
                                    </div>

                                    {/* Table header */}
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 160px 40px",
                                        gap: "8px",
                                        marginBottom: "6px",
                                        padding: "0 4px",
                                    }}>
                                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Wallet Address
                                        </span>
                                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Salary (USDC)
                                        </span>
                                        <span />
                                    </div>

                                    {/* Recipient rows */}
                                    <AnimatePresence>
                                        {formRecipients.map((recipient) => (
                                            <motion.div
                                                key={recipient.id}
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: 20 }}
                                                transition={{ duration: 0.2 }}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "1fr 160px 40px",
                                                    gap: "8px",
                                                    marginBottom: "8px",
                                                }}
                                            >
                                                <input
                                                    type="text"
                                                    placeholder="0x..."
                                                    value={recipient.employeeWallet}
                                                    onChange={(e) => updateRecipient(recipient.id, "employeeWallet", e.target.value)}
                                                    style={{ ...styles.input, fontSize: "13px", padding: "8px 12px" }}
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="0.00"
                                                    value={recipient.salaryAmountUsdc}
                                                    onChange={(e) => updateRecipient(recipient.id, "salaryAmountUsdc", e.target.value)}
                                                    min={0}
                                                    step={0.01}
                                                    style={{ ...styles.input, fontSize: "13px", padding: "8px 12px" }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeRecipientRow(recipient.id)}
                                                    disabled={formRecipients.length <= 1}
                                                    style={{
                                                        background: "transparent",
                                                        border: "none",
                                                        color: formRecipients.length <= 1
                                                            ? "rgba(255,255,255,0.15)"
                                                            : "rgba(239, 68, 68, 0.7)",
                                                        cursor: formRecipients.length <= 1 ? "not-allowed" : "pointer",
                                                        padding: "8px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        borderRadius: "6px",
                                                        transition: "color 0.2s",
                                                    }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>

                                    {/* Total display */}
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "flex-end",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 52px 0 0",
                                        fontSize: "13px",
                                        color: "rgba(255,255,255,0.5)",
                                    }}>
                                        <DollarSign size={14} />
                                        Total per cycle:
                                        <span style={{ color: "white", fontWeight: 600 }}>
                                            {formTotalUsdc.toFixed(2)} USDC
                                        </span>
                                    </div>
                                </div>

                                {/* Action buttons row */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    flexWrap: "wrap",
                                    borderTop: "1px solid rgba(255,255,255,0.06)",
                                    paddingTop: "20px",
                                }}>
                                    {/* Permit2 Signature button */}
                                    <button
                                        type="button"
                                        onClick={handleSignPermit2}
                                        disabled={isSigning || !!permit2Sig}
                                        style={{
                                            ...styles.secondaryBtn,
                                            borderColor: permit2Sig
                                                ? "rgba(16, 185, 129, 0.3)"
                                                : "rgba(255, 255, 255, 0.12)",
                                            color: permit2Sig
                                                ? "#34d399"
                                                : "rgba(255, 255, 255, 0.8)",
                                            background: permit2Sig
                                                ? "rgba(16, 185, 129, 0.1)"
                                                : "rgba(255, 255, 255, 0.06)",
                                            cursor: permit2Sig ? "default" : "pointer",
                                            opacity: isSigning ? 0.7 : 1,
                                        }}
                                    >
                                        {isSigning ? (
                                            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                                        ) : permit2Sig ? (
                                            <CheckCircle size={14} />
                                        ) : (
                                            <Shield size={14} />
                                        )}
                                        {isSigning
                                            ? "Signing..."
                                            : permit2Sig
                                            ? "Permit2 Signed"
                                            : "Sign Permit2 Approval"}
                                    </button>

                                    {/* Submit button */}
                                    <button
                                        type="button"
                                        onClick={handleCreateCampaign}
                                        disabled={isSubmitting || !permit2Sig}
                                        style={{
                                            ...styles.primaryBtn,
                                            opacity: isSubmitting || !permit2Sig ? 0.5 : 1,
                                            cursor: isSubmitting || !permit2Sig ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        {isSubmitting ? (
                                            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                                        ) : (
                                            <CheckCircle size={16} />
                                        )}
                                        {isSubmitting ? "Creating..." : "Create Campaign"}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ============================================================ */}
                {/*  Campaign List                                               */}
                {/* ============================================================ */}

                {/* Loading skeleton */}
                {pageIsLoading && (
                    <div>
                        {[1, 2, 3].map((n) => (
                            <motion.div
                                key={`skel-${n}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: n * 0.1 }}
                                style={styles.card}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ ...styles.skeletonBlock, height: "20px", width: "200px", marginBottom: "12px" }} />
                                        <div style={{ display: "flex", gap: "24px" }}>
                                            <div style={{ ...styles.skeletonBlock, height: "14px", width: "100px" }} />
                                            <div style={{ ...styles.skeletonBlock, height: "14px", width: "120px" }} />
                                            <div style={{ ...styles.skeletonBlock, height: "14px", width: "80px" }} />
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                        <div style={{ ...styles.skeletonBlock, height: "36px", width: "90px" }} />
                                        <div style={{ ...styles.skeletonBlock, height: "36px", width: "36px" }} />
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}

                {/* Error state */}
                {!pageIsLoading && loadError && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            ...styles.card,
                            textAlign: "center",
                            padding: "40px 24px",
                            borderColor: "rgba(239, 68, 68, 0.2)",
                        }}
                    >
                        <AlertTriangle size={36} style={{ color: "#f87171", marginBottom: "12px" }} />
                        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}>
                            Failed to Load Campaigns
                        </h3>
                        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", marginBottom: "16px" }}>
                            {loadError}
                        </p>
                        <button
                            style={styles.secondaryBtn}
                            onClick={fetchCampaigns}
                        >
                            Try Again
                        </button>
                    </motion.div>
                )}

                {/* Empty state */}
                {!pageIsLoading && !loadError && campaigns.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            ...styles.card,
                            textAlign: "center",
                            padding: "60px 24px",
                        }}
                    >
                        <Calendar size={40} style={{ color: "rgba(255,255,255,0.2)", marginBottom: "12px" }} />
                        <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "6px" }}>
                            No Payroll Campaigns
                        </h3>
                        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", marginBottom: "20px" }}>
                            Create your first campaign to start automating salary payments.
                        </p>
                        {!showCreateForm && (
                            <button
                                style={styles.primaryBtn}
                                onClick={() => setShowCreateForm(true)}
                            >
                                <Plus size={16} />
                                Create Campaign
                            </button>
                        )}
                    </motion.div>
                )}

                {/* Campaign cards */}
                {!pageIsLoading && !loadError && campaigns.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                    >
                        {campaigns.map((campaign, index) => {
                            const totalMicro = campaign.recipients.reduce(
                                (sum, r) => sum + r.salaryAmountUsdc, 0
                            );
                            const isToggling = togglingIds.has(campaign.id);
                            const isDeleting = deletingIds.has(campaign.id);
                            const nextDate = new Date(campaign.nextPayday);
                            const isOverdue = nextDate < new Date() && campaign.status === "ACTIVE";

                            return (
                                <motion.div
                                    key={campaign.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.08 }}
                                    style={styles.card}
                                >
                                    {/* Top row: title + status + actions */}
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "flex-start",
                                        marginBottom: "16px",
                                        flexWrap: "wrap",
                                        gap: "12px",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
                                                {campaign.title}
                                            </h3>
                                            <span style={
                                                campaign.status === "ACTIVE"
                                                    ? styles.activeBadge
                                                    : styles.pausedBadge
                                            }>
                                                {campaign.status === "ACTIVE" ? (
                                                    <CheckCircle size={12} />
                                                ) : (
                                                    <Pause size={12} />
                                                )}
                                                {campaign.status}
                                            </span>
                                            {campaign.isShielded && (
                                                <span style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "4px",
                                                    fontSize: "12px",
                                                    color: "#8b5cf6",
                                                    background: "rgba(139, 92, 246, 0.1)",
                                                    border: "1px solid rgba(139, 92, 246, 0.25)",
                                                    borderRadius: "20px",
                                                    padding: "4px 10px",
                                                    fontWeight: 500,
                                                }}>
                                                    <Shield size={12} />
                                                    Shielded
                                                </span>
                                            )}
                                        </div>

                                        {/* Action buttons */}
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <button
                                                style={{
                                                    ...styles.secondaryBtn,
                                                    opacity: isToggling ? 0.6 : 1,
                                                    cursor: isToggling ? "not-allowed" : "pointer",
                                                }}
                                                onClick={() => handleToggleStatus(campaign)}
                                                disabled={isToggling}
                                            >
                                                {isToggling ? (
                                                    <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                                                ) : campaign.status === "ACTIVE" ? (
                                                    <Pause size={14} />
                                                ) : (
                                                    <Play size={14} />
                                                )}
                                                {campaign.status === "ACTIVE" ? "Pause" : "Resume"}
                                            </button>
                                            <button
                                                style={{
                                                    ...styles.dangerBtn,
                                                    opacity: isDeleting ? 0.6 : 1,
                                                    cursor: isDeleting ? "not-allowed" : "pointer",
                                                }}
                                                onClick={() => handleDelete(campaign.id)}
                                                disabled={isDeleting}
                                            >
                                                {isDeleting ? (
                                                    <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                                                ) : (
                                                    <Trash2 size={14} />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Campaign details row */}
                                    <div style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: "24px",
                                        fontSize: "13px",
                                        color: "rgba(255,255,255,0.55)",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Clock size={14} style={{ color: "rgba(255,255,255,0.35)" }} />
                                            {frequencyLabel(campaign.frequencyDays)}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Calendar size={14} style={{ color: isOverdue ? "#f87171" : "rgba(255,255,255,0.35)" }} />
                                            <span style={{ color: isOverdue ? "#f87171" : undefined }}>
                                                Next: {nextDate.toLocaleDateString("en-US", {
                                                    month: "short",
                                                    day: "numeric",
                                                    year: "numeric",
                                                })}
                                                {isOverdue && " (overdue)"}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Users size={14} style={{ color: "rgba(255,255,255,0.35)" }} />
                                            {campaign.recipients.length} recipient{campaign.recipients.length !== 1 ? "s" : ""}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <DollarSign size={14} style={{ color: "rgba(255,255,255,0.35)" }} />
                                            <span style={{ color: "white", fontWeight: 500 }}>
                                                {formatUsdc(totalMicro)} USDC
                                            </span>
                                            <span style={{ color: "rgba(255,255,255,0.35)" }}>/ cycle</span>
                                        </div>
                                    </div>

                                    {/* Recipient breakdown (collapsed by default, expandable) */}
                                    {campaign.recipients.length > 0 && (
                                        <RecipientList recipients={campaign.recipients} />
                                    )}
                                </motion.div>
                            );
                        })}
                    </motion.div>
                )}
                </div>
            </div>

            {/* Spin keyframe for Loader2 */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Recipient list sub-component                                       */
/* ------------------------------------------------------------------ */

function RecipientList({ recipients }: { recipients: PayrollCampaign["recipients"] }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div style={{ marginTop: "14px" }}>
            <button
                onClick={() => setExpanded((prev) => !prev)}
                style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.45)",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 0",
                    fontWeight: 500,
                    transition: "color 0.2s",
                }}
            >
                <Users size={12} />
                {expanded ? "Hide recipients" : "Show recipients"}
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{
                            marginTop: "10px",
                            background: "rgba(255,255,255,0.02)",
                            borderRadius: "10px",
                            border: "1px solid rgba(255,255,255,0.05)",
                            padding: "12px 16px",
                        }}>
                            {/* Table header */}
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 120px",
                                gap: "8px",
                                paddingBottom: "8px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                marginBottom: "8px",
                            }}>
                                <span style={{
                                    fontSize: "11px",
                                    color: "rgba(255,255,255,0.35)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                }}>
                                    Wallet
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: "rgba(255,255,255,0.35)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                    textAlign: "right",
                                }}>
                                    Amount
                                </span>
                            </div>

                            {/* Rows */}
                            {recipients.map((r) => (
                                <div
                                    key={r.id}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 120px",
                                        gap: "8px",
                                        padding: "6px 0",
                                        fontSize: "13px",
                                    }}
                                >
                                    <span style={{
                                        color: "rgba(255,255,255,0.65)",
                                        fontFamily: "monospace",
                                        fontSize: "12px",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}>
                                        {r.employeeWallet}
                                    </span>
                                    <span style={{
                                        color: "white",
                                        fontWeight: 500,
                                        textAlign: "right",
                                        fontSize: "13px",
                                    }}>
                                        {formatUsdc(r.salaryAmountUsdc)} USDC
                                    </span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
