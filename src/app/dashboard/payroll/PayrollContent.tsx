"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useSignTypedData, useConnect, useDisconnect, useWriteContract, useSwitchChain, useSignMessage } from "wagmi";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Plus, Pause, Play, Trash2, Users, Calendar,
    Shield, ShieldOff, Loader2, CheckCircle, AlertTriangle,
    DollarSign, Clock, Building2, Lock, Crown, Zap, Activity,
    BarChart3, Link2, Sliders, User, Key, Code2, Webhook, PlugZap
} from "@/components/icons";
import DashboardHeader from "@/components/DashboardHeader";
import Skeleton from "@/components/ui/Skeleton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import WithdrawModal from "@/components/WithdrawModal";
import DepositModal from "@/components/DepositModal";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import { 
    SUBSCRIPT_ROUTER_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import {
    SUBSCRIPT_ROUTER_ABI,
    USDC_ERC20_ABI
} from "@/lib/contracts/abis";
import { buildPermitSingle, payrollPermitWindow } from "@/lib/payroll/permit2";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "premium", label: "Premium", icon: Crown },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "payment-links", label: "Payments and Subscriptions", icon: Sliders },
    { id: "payroll", label: "Payroll", icon: Building2, href: "/merchant/payroll" },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "settings", label: "Profile & DNS", icon: User },
] as const;

type TabId = "overview" | "premium" | "analytics" | "payment-links" | "payroll" | "apikeys" | "checkout" | "webhooks" | "settings";

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: arcHttp(),
});

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
    chainId: 5042002,
    verifyingContract: PERMIT2_ADDRESS,
} as const;

/* Read the current Permit2 nonce for (owner, token, spender). */
const PERMIT2_ALLOWANCE_ABI = [
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "user", type: "address" },
            { name: "token", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [
            { name: "amount", type: "uint160" },
            { name: "expiration", type: "uint48" },
            { name: "nonce", type: "uint48" },
        ],
    },
] as const;

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
    totalPayrollUsdc: string;
    recipients: Array<{
        id: string;
        employeeWallet: string;
        salaryAmountUsdc: number;
        employeeAlias?: string | null;
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

function parseUsdcToMicro(value: string): bigint | null {
    const normalized = value.trim();
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(normalized);
    if (!match) return null;
    const amount = BigInt(match[1]) * BigInt(1_000_000)
        + BigInt((match[2] || "").padEnd(6, "0") || "0");
    return amount > BigInt(0) ? amount : null;
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

export function PayrollContent({ embedded = false }: { embedded?: boolean }) {
    const router = useRouter();

    /* ----- wallet state ----- */
    const { address: realAddress, isConnected: realIsConnected } = useAccount();
    const { signTypedDataAsync } = useSignTypedData();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { signMessageAsync } = useSignMessage();

    /* ----- page state ----- */
    const [isMounted, setIsMounted] = useState(false);
    const [campaigns, setCampaigns] = useState<PayrollCampaign[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [merchantTier, setMerchantTier] = useState<string | null>(null);
    const [isLoadingTier, setIsLoadingTier] = useState(true);
    const [isTestMode, setIsTestMode] = useState(false);

    /* ----- Session & Embedded Wallet States ----- */
    const [embeddedWallet, setEmbeddedWallet] = useState<{ wallet: string; email: string } | null>(null);
    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const activeMerchantAddress = useMemo(() => {
        if (isTestMode) return "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
        return embeddedWallet?.wallet || realAddress || sessionWallet || "";
    }, [embeddedWallet, realAddress, isTestMode, sessionWallet]);

    const isConnected = realIsConnected || isTestMode || !!embeddedWallet || !!sessionWallet;
    const address = activeMerchantAddress;

    /* ----- Header balances & modals states ----- */
    const [vaultBalance, setVaultBalance] = useState(0);
    const [payoutDestination, setPayoutDestination] = useState<string | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [isPremium, setIsPremium] = useState(false);
    const [promptFlowMode, setPromptFlowMode] = useState<"standard" | "private">("standard");
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);

    const pageIsLoading = isLoading || isLoadingTier || isAuthLoading;

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
    const [permit2Nonce, setPermit2Nonce] = useState<number | null>(null);
    const [permit2Deadline, setPermit2Deadline] = useState<string | null>(null);
    const [permit2Expiration, setPermit2Expiration] = useState<string | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    /* ----- action-in-progress trackers ----- */
    const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

    /* ------------------------------------------------------------------ */
    /*  Mount & Session Restoration                                       */
    /* ------------------------------------------------------------------ */

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== "undefined") {
            setIsTestMode(
                Boolean(window.navigator.webdriver || document.cookie.includes("subscript_e2e_test=true"))
            );
        }
    }, []);

    useEffect(() => {
        const restoreSession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn && data.wallet) {
                    setSessionWallet(data.wallet.toLowerCase());
                    if (data.isEmbedded) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                    } else {
                        setEmbeddedWallet(null);
                    }
                }
            } catch (err) {
                console.error("Error restoring session:", err);
            } finally {
                setIsAuthLoading(false);
            }
        };
        restoreSession();
    }, []);

    useEffect(() => {
        if (!address) {
            setSessionWallet(null);
            return;
        }

        const verifySession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn) {
                    if (data.isEmbedded) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                    } else if (data.wallet.toLowerCase() === address.toLowerCase()) {
                        setSessionWallet(data.wallet.toLowerCase());
                    } else {
                        setSessionWallet(null);
                    }
                } else {
                    setSessionWallet(null);
                }
            } catch (err) {
                console.error("Error verifying session:", err);
            }
        };

        if (isConnected && !embeddedWallet) {
            verifySession();
        }
    }, [address, isConnected, embeddedWallet]);

    /* ------------------------------------------------------------------ */
    /*  Toast helper                                                       */
    /* ------------------------------------------------------------------ */

    const showToastMessage = useCallback((message: string, type: ToastState["type"] = "info") => {
        setToast({ visible: true, message, type });
        setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 4000);
    }, []);

    /* ------------------------------------------------------------------ */
    /*  Fetch campaigns & tier details                                     */
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

    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;
        try {
            const [vaultRaw, payoutRaw, walletRaw] = await Promise.all([
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ROUTER_ABI,
                    functionName: "merchantBalances",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ROUTER_ABI,
                    functionName: "merchantPayoutDestination",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: USDC_ERC20_ABI,
                    functionName: "balanceOf",
                    args: [address as `0x${string}`],
                }),
            ]);

            setVaultBalance(parseFloat(formatUnits(vaultRaw, 6)));
            setPayoutDestination(payoutRaw && payoutRaw !== "0x0000000000000000000000000000000000000000" ? payoutRaw : null);
            setWalletBalance(parseFloat(formatUnits(walletRaw as bigint, 6)));

            const tierRes = await fetch(`/api/merchant/tier?address=${address}`);
            if (tierRes.ok) {
                const tierData = await tierRes.json();
                const hasPremium = Number(tierData.tier) >= 1;
                setIsPremium(hasPremium);
                setMerchantTier(hasPremium ? "PREMIUM" : "FREE");
            } else {
                setMerchantTier("FREE");
                setIsPremium(false);
            }
        } catch (error) {
            console.error("Error reading contract data in background:", error);
        } finally {
            setIsLoadingTier(false);
        }
    }, [address]);

    useEffect(() => {
        if (isMounted && address) {
            fetchCampaigns();
            refetchBalancesAndTier();
            const interval = setInterval(refetchBalancesAndTier, 8000);
            return () => clearInterval(interval);
        }
    }, [isMounted, address, fetchCampaigns, refetchBalancesAndTier]);

    /* ------------------------------------------------------------------ */
    /*  Auth Actions                                                      */
    /* ------------------------------------------------------------------ */

    const handleConnect = () => {
        const mm = connectors.find((c) => c.id === "injected" || c.name.toLowerCase().includes("metamask"));
        if (mm) {
            connect({ connector: mm });
        } else if (connectors[0]) {
            connect({ connector: connectors[0] });
        }
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            setSessionWallet(null);
            setEmbeddedWallet(null);
        } catch (err) {
            console.error("Error logging out:", err);
        }
    };

    const handleBackendLogin = async () => {
        if (embeddedWallet) return;
        if (!activeMerchantAddress) return;
        setIsLoggingIn(true);
        try {
            const nonceRes = await fetch("/api/auth/nonce");
            const nonceData = await nonceRes.json();
            if (!nonceRes.ok || !nonceData.nonce) {
                throw new Error(nonceData.error || "Failed to fetch nonce");
            }
            const fetchedNonce = nonceData.nonce;
            const message = buildWalletAuthMessage({ address, nonce: fetchedNonce, domain: window.location.host, uri: window.location.origin });
            const signature = await signMessageAsync({ message });
            
            const res = await fetch("/api/auth/verify-signature", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: activeMerchantAddress, signature, nonce: fetchedNonce }),
            });
            
            const data = await res.json();
            if (data.success) {
                setSessionWallet(activeMerchantAddress.toLowerCase());
            } else {
                console.error("Login failed:", data.error);
            }
        } catch (err) {
            console.error("Error signing message:", err);
        } finally {
            setIsLoggingIn(false);
        }
    };

    const executeContractWrite = async ({
        address: contractAddress,
        abi: contractAbi,
        functionName,
        args = [],
    }: {
        address: string;
        abi: any;
        functionName: string;
        args?: any[];
    }) => {
        if (embeddedWallet) {
            let action = "";
            let serializedArgs: any = {};

            if (functionName === "withdraw") {
                action = "withdraw";
                serializedArgs = {};
            } else {
                throw new Error(`Execution intent not allowlisted for embedded wallets: ${functionName}`);
            }

            const res = await fetch("/api/execute-tx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, args: serializedArgs }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Server transaction execution failed");
            }
            return data.txHash as string;
        } else {
            /* Handled via wagmi writeContract when using browser wallet */
            throw new Error("Only embedded wallet server executions are routed through executeContractWrite on this tab.");
        }
    };

    const handleWithdraw = async (targetAddress?: string) => {
        if (vaultBalance <= 0) return;
        setIsWithdrawing(true);
        try {
            const hasTarget = targetAddress && targetAddress.toLowerCase() !== address?.toLowerCase();
            await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: SUBSCRIPT_ROUTER_ABI,
                functionName: hasTarget ? "withdrawTo" : "withdraw",
                args: hasTarget ? [targetAddress as `0x${string}`] : [],
            });

            setWithdrawSuccess(true);
            showToastMessage("Withdrawal transaction submitted", "success");
            setTimeout(() => setWithdrawSuccess(false), 4000);
            refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Withdraw failed:", err);
            showToastMessage(err.message || "Withdrawal failed", "error");
        } finally {
            setIsWithdrawing(false);
        }
    };

    const handleDepositSuccess = () => {
        refetchBalancesAndTier();
    };

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
                const parsed = parseUsdcToMicro(r.salaryAmountUsdc);
                if (parsed) totalMicro += parsed;
            }

            if (totalMicro === BigInt(0)) {
                showToastMessage("Add at least one recipient with a salary amount", "error");
                setIsSigning(false);
                return;
            }
            const frequencyDays = formFrequencyPreset === 0
                ? parseInt(formCustomDays, 10)
                : formFrequencyPreset;
            const window = payrollPermitWindow(frequencyDays);

            if (embeddedWallet) {
                /* Embedded merchant (the only kind now): the server approves USDC -> Permit2 and signs
                   the authorization from the embedded key. */
                const res = await fetch("/api/merchant/payroll/permit-sign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        totalAmountUsdc: totalMicro.toString(),
                        frequencyDays,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || "Could not authorize payroll.");
                setPermit2Sig(data.signature);
                setPermit2Nonce(Number(data.nonce));
                setPermit2Deadline(data.permit2Deadline);
                setPermit2Expiration(data.permit2Expiration);
                showToastMessage("Payroll authorization signed", "success");
                return;
            }

            /* External wallet: sign the keeper-spender authorization built from the shared module, with
               the keeper address and current on-chain Permit2 nonce — so the signed message is
               byte-identical to what the keeper submits. Assumes USDC is already approved to Permit2. */
            const keeperRes = await fetch("/api/merchant/payroll/keeper");
            const keeperData = await keeperRes.json();
            if (!keeperRes.ok || !keeperData.keeperAddress) throw new Error(keeperData.error || "Could not load the payroll keeper.");
            const keeperAddress = keeperData.keeperAddress as `0x${string}`;

            const allowanceRes = (await publicClient.readContract({
                address: PERMIT2_ADDRESS as `0x${string}`,
                abi: PERMIT2_ALLOWANCE_ABI,
                functionName: "allowance",
                args: [address as `0x${string}`, USDC_ADDRESS as `0x${string}`, keeperAddress],
            })) as readonly [bigint, number, number];
            const nonce = Number(allowanceRes[2]);

            const message = buildPermitSingle(
                USDC_ADDRESS,
                keeperAddress,
                nonce,
                totalMicro,
                window.expiration,
                window.sigDeadline,
            );
            const signature = await signTypedDataAsync({
                domain: PERMIT2_DOMAIN,
                types: PERMIT2_TYPES,
                primaryType: "PermitSingle",
                message: message as any,
            });
            setPermit2Sig(signature);
            setPermit2Nonce(nonce);
            setPermit2Deadline(new Date(Number(window.sigDeadline) * 1000).toISOString());
            setPermit2Expiration(new Date(Number(window.expiration) * 1000).toISOString());
            showToastMessage("Payroll authorization signed", "success");
        } catch (err: any) {
            showToastMessage(err?.shortMessage || err?.message || "Signing failed", "error");
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
            showToastMessage("Campaign title is required", "error");
            return;
        }
        const frequencyDays = formFrequencyPreset === 0
            ? parseInt(formCustomDays, 10)
            : formFrequencyPreset;

        if (!frequencyDays || frequencyDays < 1) {
            showToastMessage("Frequency must be at least 1 day", "error");
            return;
        }

        /* Validate recipients */
        const validRecipients = formRecipients.filter(
            (r) => r.employeeWallet.trim() && parseUsdcToMicro(r.salaryAmountUsdc) !== null
        );
        if (validRecipients.length === 0) {
            showToastMessage("Add at least one recipient with a wallet and salary", "error");
            return;
        }

        const isAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address);
        const isDns = (address: string) => /\.sub$/.test(address);

        const invalidAddress = validRecipients.find(
            (r) => !isAddress(r.employeeWallet.trim()) && !isDns(r.employeeWallet.trim())
        );
        if (invalidAddress) {
            showToastMessage(`Recipient "${invalidAddress.employeeWallet}" must be a valid 0x address or .sub DNS name`, "error");
            return;
        }
        if (!permit2Sig) {
            showToastMessage("Please sign the Permit2 approval first", "error");
            return;
        }

        setIsSubmitting(true);
        try {
            const body = {
                title: formTitle.trim(),
                frequencyDays,
                isShielded: formShielded,
                permit2Signature: permit2Sig,
                permit2Nonce,
                permit2Deadline,
                permit2Expiration,
                recipients: validRecipients.map((r) => ({
                    employeeWallet: r.employeeWallet.trim(),
                    salaryAmountUsdc: parseUsdcToMicro(r.salaryAmountUsdc)!.toString(),
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

            showToastMessage("Payroll campaign created successfully", "success");
            resetCreateForm();
            fetchCampaigns();
        } catch (err: any) {
            showToastMessage(err.message || "Failed to create campaign", "error");
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
            let authorization: Record<string, unknown> = {};
            if (newStatus === "ACTIVE") {
                const permitRes = await fetch("/api/merchant/payroll/permit-sign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        totalAmountUsdc: campaign.totalPayrollUsdc,
                        frequencyDays: campaign.frequencyDays,
                    }),
                });
                const permit = await permitRes.json().catch(() => ({}));
                if (!permitRes.ok || !permit.success) {
                    throw new Error(permit.error || "Could not renew the payroll authorization");
                }
                authorization = {
                    permit2Signature: permit.signature,
                    permit2Nonce: Number(permit.nonce),
                    permit2Deadline: permit.permit2Deadline,
                    permit2Expiration: permit.permit2Expiration,
                };
            }
            const res = await fetch("/api/merchant/payroll", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaignId: campaign.id,
                    action: newStatus === "ACTIVE" ? "RESUME" : "PAUSE",
                    ...authorization,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to update campaign");
            }

            setCampaigns((prev) =>
                prev.map((c) => (c.id === campaign.id ? { ...c, status: newStatus } : c))
            );
            showToastMessage(
                newStatus === "ACTIVE" ? "Campaign resumed" : "Campaign paused",
                "success"
            );
        } catch (err: any) {
            showToastMessage(err.message || "Failed to toggle campaign", "error");
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
        if (!confirm("Are you sure you want to delete this payroll campaign?")) return;
        setDeletingIds((prev) => new Set(prev).add(id));
        try {
            const res = await fetch(`/api/merchant/payroll?id=${id}`, { method: "DELETE" });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to delete campaign");
            }

            setCampaigns((prev) => prev.filter((c) => c.id !== id));
            showToastMessage("Campaign deleted", "success");
        } catch (err: any) {
            showToastMessage(err.message || "Failed to delete campaign", "error");
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
        setPermit2Nonce(null);
        setPermit2Deadline(null);
        setPermit2Expiration(null);
    };

    /* ------------------------------------------------------------------ */
    /*  Computed values                                                    */
    /* ------------------------------------------------------------------ */

    const formTotalUsdc = formRecipients.reduce((sum, r) => {
        const val = parseFloat(r.salaryAmountUsdc);
        return sum + (isNaN(val) ? 0 : val);
    }, 0);

    /* ------------------------------------------------------------------ */
    /*  Render                                                             */
    /* ------------------------------------------------------------------ */

    if (!isMounted) {
        return (
            <div className="min-h-screen bg-transparent text-white border-t-4 border-[#00d2b4] relative z-10 flex flex-col items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-[#00d2b4]" />
            </div>
        );
    }

    return (
        <div data-mounted={isMounted} className={embedded ? "text-white" : "min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4]"}>
            {!embedded && <AnimatedGradientBg variant="dashboard" />}

            <div className="relative z-10">
                {!embedded && (
                <DashboardHeader
                    embeddedWallet={embeddedWallet}
                    onDisconnect={handleLogout}
                    vaultBalance={vaultBalance}
                    onWithdraw={async () => setIsWithdrawOpen(true)}
                    isWithdrawing={isWithdrawing}
                    onDepositSuccess={handleDepositSuccess}
                    isPremium={isPremium}
                    promptFlowMode={promptFlowMode}
                    onDeposit={() => setIsDepositOpen(true)}
                    activeTab="payroll"
                    onBackToOverview={() => router.push("/merchant")}
                />
                )}

                {/* Main Content Layout */}
                <main className={embedded ? "" : "max-w-7xl mx-auto px-6 pt-28 pb-12"}>
                    {/* Header Row */}
                    {!embedded && (
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 pb-6 border-b border-white/5">
                        <div className="flex items-center gap-3">
                            <Link
                                href="/merchant"
                                className="md:hidden p-2.5 text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-full transition-all"
                                title="Back to Dashboard"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                            </Link>
                            <div>
                                <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">
                                    Merchant Control <span className="font-serif italic lowercase font-normal text-[#00d2b4]">center</span>
                                </h1>
                                <p className="text-xs text-white/50 font-sans">
                                    Manage and monitor your institutional payroll streams.
                                </p>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* Check if connected */}
                    {!isConnected ? (
                        <div className="space-y-8">
                            <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
                                <div className="p-4 rounded-3xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                                    <AlertTriangle className="w-10 h-10" />
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-lg font-bold text-white uppercase tracking-wider">Merchant Wallet Connection Required</h2>
                                    <p className="text-sm text-white/60 max-w-md leading-relaxed font-sans">
                                        Connect your browser wallet to access allowances, metrics, premium features, and settlement configurations.
                                    </p>
                                </div>
                                <button
                                    onClick={handleConnect}
                                    className="px-8 py-3 bg-yellow-300 hover:bg-yellow-200 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(234,179,8,0.2)] font-sans"
                                >
                                    <PlugZap className="w-4 h-4" />
                                    {isConnecting ? "Connecting Wallet..." : "Connect Merchant Wallet"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Two-column layout matching main dashboard */
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
                            
                            {/* Left Column: Sidebar Navigation */}
                            <div className={embedded ? "hidden" : "hidden lg:block lg:col-span-1 space-y-2"}>
                                {tabs.map((tab) => {
                                    const isSelected = tab.id === "payroll";
                                    const tabHref = tab.id === "payroll" ? "/merchant/payroll" : `/merchant?tab=${tab.id}`;
                                    
                                    const itemClasses = `w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left ${
                                        isSelected
                                            ? "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white shadow-lg shadow-[#00d2b4]/5"
                                            : "bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.03]"
                                    }`;
                                    
                                    const iconClasses = `w-4 h-4 ${
                                        isSelected ? "text-[#00d2b4]" : "text-white/40"
                                    }`;

                                    return (
                                        <Link
                                            key={tab.id}
                                            href={tabHref}
                                            className={itemClasses}
                                        >
                                            <tab.icon className={iconClasses} />
                                            {tab.label}
                                            {tab.id === "premium" && isPremium && (
                                                <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20">PRO</span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* Right Column: Active Tab Content */}
                            <div className={embedded ? "col-span-1 lg:col-span-4 min-h-[500px]" : "col-span-1 lg:col-span-3 min-h-[500px]"}>
                                {/* Mobile back button */}
                                <div className={embedded ? "hidden" : "lg:hidden mb-6"}>
                                    <Link
                                        href="/merchant"
                                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-all font-sans"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                        Back to Dashboard
                                    </Link>
                                </div>
                                
                                {/* Session check: Verify wallet ownership */}
                                {isConnected && address && !sessionWallet && !embeddedWallet ? (
                                    <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
                                        <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                                        <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                                        <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                                            To protect your payment configurations and links, please sign a secure message using your connected wallet.
                                        </p>
                                        <button
                                            onClick={handleBackendLogin}
                                            disabled={isLoggingIn}
                                            className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all font-sans"
                                        >
                                            {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Shield className="w-4 h-4" />}
                                            {isLoggingIn ? "Signing Message..." : "Verify Wallet Ownership"}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        {/* High fidelity Gold Premium Lock Overlay */}
                                        {!pageIsLoading && merchantTier === "FREE" && (
                                            <div className="liquid-glass border border-[#d4a853]/20 rounded-3xl p-10 shadow-2xl bg-black/60 flex flex-col items-center justify-center text-center gap-6 min-h-[400px] relative overflow-hidden">
                                                <div className="absolute top-0 right-0 w-64 h-64 bg-[#d4a853]/5 rounded-full blur-3xl -z-10" />
                                                <div className="p-5 rounded-3xl bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] animate-pulse">
                                                    <Crown className="w-12 h-12" />
                                                </div>
                                                <div className="space-y-3 max-w-md">
                                                    <h2 className="text-xl font-extrabold text-white uppercase tracking-wider">Privacy Premium Feature Locked</h2>
                                                    <p className="text-xs text-white/60 leading-relaxed font-sans">
                                                        Access to <span className="font-semibold text-white">Institutional Payroll</span> requires an active SubScript Privacy Premium subscription. Upgrade to unlock keys, private checkout generation, webhook event streaming, and batch payouts.
                                                    </p>
                                                </div>
                                                <Link
                                                    href="/merchant/upgrade"
                                                    className="px-8 py-3 bg-[#d4a853] hover:bg-[#d4a853]/80 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(212,168,83,0.2)] font-sans"
                                                >
                                                    <Crown className="w-4 h-4" />
                                                    Upgrade to Privacy Premium
                                                </Link>
                                            </div>
                                        )}

                                        {/* Main Payroll Content Container (hidden or blurred if locked) */}
                                        <div className={merchantTier === "FREE" && !pageIsLoading ? "opacity-20 pointer-events-none filter blur-sm transition-all" : "transition-all"}>
                                            
                                            {/* Header Section */}
                                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
                                                <div>
                                                    <h2 className="text-2xl font-extrabold text-white uppercase tracking-tight flex items-center gap-3 font-sans">
                                                        <Building2 size={24} className="text-[#00d2b4]" />
                                                        Institutional Payroll
                                                    </h2>
                                                    <p className="text-xs text-white/50 font-sans mt-1">
                                                        Automate recurring salary payments and batch payouts to your team.
                                                    </p>
                                                </div>

                                                <button
                                                    onClick={() => setShowCreateForm((prev) => !prev)}
                                                    className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 text-black rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.15)] font-sans"
                                                >
                                                    {showCreateForm ? <Plus size={16} className="rotate-45 transition-transform duration-200" /> : <Plus size={16} />}
                                                    {showCreateForm ? "Cancel" : "New Campaign"}
                                                </button>
                                            </div>

                                            {/* Create Campaign Expandable Panel */}
                                            <AnimatePresence>
                                                {showCreateForm && (
                                                    <motion.div
                                                        key="create-form"
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.35 }}
                                                        className="overflow-hidden mb-6"
                                                    >
                                                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 shadow-2xl relative overflow-hidden mb-6">
                                                            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2 font-sans">
                                                                <Plus size={16} className="text-[#00d2b4]" />
                                                                Create Payroll Campaign
                                                            </h3>

                                                            {/* Campaign Title */}
                                                            <div className="mb-4">
                                                                <label className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 block font-sans">Campaign Title</label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="e.g. Engineering Team - Monthly"
                                                                    value={formTitle}
                                                                    onChange={(e) => setFormTitle(e.target.value)}
                                                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans"
                                                                />
                                                            </div>

                                                            {/* Frequency and Shielded selection */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                                {/* Frequency */}
                                                                <div>
                                                                    <label className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 block font-sans">Pay Frequency</label>
                                                                    <select
                                                                        value={formFrequencyPreset}
                                                                        onChange={(e) => setFormFrequencyPreset(Number(e.target.value))}
                                                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#00d2b4] transition-colors appearance-none font-sans"
                                                                    >
                                                                        {FREQUENCY_OPTIONS.map((opt) => (
                                                                            <option key={opt.value} value={opt.value} className="bg-black text-white">
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
                                                                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#00d2b4] transition-colors mt-2 font-sans"
                                                                        />
                                                                    )}
                                                                </div>

                                                                {/* Shielded toggle */}
                                                                <div>
                                                                    <label className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 block font-sans">Privacy Mode</label>
                                                                    <div
                                                                        className={`flex items-center gap-3 cursor-pointer px-4 py-3.5 rounded-xl border transition-all ${
                                                                            formShielded
                                                                                ? "border-[#00d2b4]/30 bg-[#00d2b4]/10 text-white shadow-sm shadow-[#00d2b4]/5"
                                                                                : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/[0.04]"
                                                                        }`}
                                                                        onClick={() => setFormShielded((prev) => !prev)}
                                                                    >
                                                                        {formShielded ? (
                                                                            <Shield size={18} className="text-[#00d2b4]" />
                                                                        ) : (
                                                                            <ShieldOff size={18} className="text-white/40" />
                                                                        )}
                                                                        <span className="text-xs font-bold uppercase tracking-wider font-sans">
                                                                            {formShielded ? "Confidential (Preview)" : "Standard (Public)"}
                                                                        </span>
                                                                    </div>
                                                                    {formShielded && (
                                                                        <p className="text-[10px] text-white/40 leading-normal mt-2 font-sans">
                                                                            Masks recipient and amount metadata in SubScript&apos;s batch event log. The underlying USDC transfers stay visible on Arc&apos;s public ledger &mdash; full on-chain privacy activates when Arc&apos;s Privacy Sector (APS) goes live.
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Recipients rows */}
                                                            <div className="mb-6">
                                                                <div className="flex justify-between items-center mb-3">
                                                                    <label className="text-xs font-bold uppercase tracking-wider text-white/50 block font-sans">
                                                                        Recipients ({formRecipients.length})
                                                                    </label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={addRecipientRow}
                                                                        className="px-3 py-1.5 rounded-lg bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 text-[#00d2b4] text-[10px] font-bold uppercase tracking-wider transition-all"
                                                                    >
                                                                        <Plus size={12} className="inline mr-1" />
                                                                        Add Row
                                                                    </button>
                                                                </div>

                                                                {/* Headers */}
                                                                <div className="grid grid-cols-[minmax(0,1fr)_110px_36px] sm:grid-cols-[minmax(0,1fr)_160px_40px] gap-2 mb-1.5 px-1">
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 font-sans">Wallet Address</span>
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 font-sans">Salary (USDC)</span>
                                                                    <span />
                                                                </div>

                                                                {/* Row Elements */}
                                                                <AnimatePresence>
                                                                    {formRecipients.map((recipient) => (
                                                                        <motion.div
                                                                            key={recipient.id}
                                                                            initial={{ opacity: 0, x: -10 }}
                                                                            animate={{ opacity: 1, x: 0 }}
                                                                            exit={{ opacity: 0, x: 10 }}
                                                                            className="grid grid-cols-[minmax(0,1fr)_110px_36px] sm:grid-cols-[minmax(0,1fr)_160px_40px] gap-2 mb-2 items-center"
                                                                        >
                                                                            <input
                                                                                type="text"
                                                                                placeholder="0x..."
                                                                                value={recipient.employeeWallet}
                                                                                onChange={(e) => updateRecipient(recipient.id, "employeeWallet", e.target.value)}
                                                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-mono"
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                placeholder="0.00"
                                                                                value={recipient.salaryAmountUsdc}
                                                                                onChange={(e) => updateRecipient(recipient.id, "salaryAmountUsdc", e.target.value)}
                                                                                min={0}
                                                                                step={0.01}
                                                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans"
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => removeRecipientRow(recipient.id)}
                                                                                disabled={formRecipients.length <= 1}
                                                                                className="p-2 text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </motion.div>
                                                                    ))}
                                                                </AnimatePresence>

                                                                {/* Total */}
                                                                <div className="flex justify-end items-center gap-2 pr-12 pt-3 text-[10px] font-bold uppercase tracking-wider text-white/50">
                                                                    <DollarSign size={12} className="text-[#00d2b4]" />
                                                                    Total per cycle:
                                                                    <span className="text-white font-extrabold text-sm ml-1">
                                                                        {formTotalUsdc.toFixed(2)} USDC
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* Actions Panel */}
                                                            <div className="flex items-center gap-3 flex-wrap border-t border-white/5 pt-5 font-sans">
                                                                <button
                                                                    type="button"
                                                                    onClick={handleSignPermit2}
                                                                    disabled={isSigning || !!permit2Sig}
                                                                    className={`px-4 py-2.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                                                                        permit2Sig
                                                                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-default"
                                                                            : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                                                                    }`}
                                                                >
                                                                    {isSigning ? (
                                                                        <Loader2 size={12} className="animate-spin" />
                                                                    ) : permit2Sig ? (
                                                                        <CheckCircle size={12} />
                                                                    ) : (
                                                                        <Shield size={12} />
                                                                    )}
                                                                    {isSigning
                                                                        ? "Signing..."
                                                                        : permit2Sig
                                                                        ? "Permit2 Signed"
                                                                        : "Sign Permit2 Approval"}
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    onClick={handleCreateCampaign}
                                                                    disabled={isSubmitting || !permit2Sig}
                                                                    className="px-6 py-2.5 bg-[#00d2b4] hover:bg-[#00d2b4]/80 disabled:opacity-50 disabled:cursor-not-allowed text-black text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2"
                                                                >
                                                                    {isSubmitting ? (
                                                                        <Loader2 size={12} className="animate-spin text-black" />
                                                                    ) : (
                                                                        <CheckCircle size={12} />
                                                                    )}
                                                                    {isSubmitting ? "Creating..." : "Create Campaign"}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {/* Skeletons Loader */}
                                            {pageIsLoading && (
                                                <div className="space-y-6">
                                                    {[1, 2, 3].map((n) => (
                                                        <div
                                                            key={`skel-${n}`}
                                                            className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden"
                                                        >
                                                            <div className="flex justify-between items-start gap-4">
                                                                <div className="flex-1 space-y-3">
                                                                    <Skeleton className="h-5 w-48" />
                                                                    <div className="flex gap-6">
                                                                        <Skeleton className="h-4 w-24" />
                                                                        <Skeleton className="h-4 w-32" />
                                                                        <Skeleton className="h-4 w-20" />
                                                                    </div>
                                                                </div>
                                                                <div className="flex gap-2">
                                                                    <Skeleton className="h-9 w-20" />
                                                                    <Skeleton className="h-9 w-9" />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Error display */}
                                            {!pageIsLoading && loadError && (
                                                <div className="liquid-glass border border-red-500/10 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-5 shadow-2xl bg-black/40">
                                                    <AlertTriangle size={36} className="text-red-400 mx-auto" />
                                                    <div className="space-y-1">
                                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Failed to Load Campaigns</h3>
                                                        <p className="text-xs text-white/50 font-sans">{loadError}</p>
                                                    </div>
                                                    <button
                                                        onClick={fetchCampaigns}
                                                        className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all mx-auto block font-sans"
                                                    >
                                                        Try Again
                                                    </button>
                                                </div>
                                            )}

                                            {/* Empty display */}
                                            {!pageIsLoading && !loadError && campaigns.length === 0 && (
                                                <div className="liquid-glass border border-white/5 rounded-3xl p-10 text-center max-w-lg mx-auto space-y-6 shadow-2xl relative overflow-hidden">
                                                    <Calendar size={40} className="text-white/20 mx-auto" />
                                                    <div className="space-y-2">
                                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">No Payroll Campaigns</h3>
                                                        <p className="text-xs text-white/50 max-w-xs mx-auto leading-relaxed font-sans">
                                                            Create your first campaign to start automating salary payments.
                                                        </p>
                                                    </div>
                                                    {!showCreateForm && (
                                                        <button
                                                            onClick={() => setShowCreateForm(true)}
                                                            className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 text-black rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.15)] mx-auto font-sans"
                                                        >
                                                            <Plus size={16} />
                                                            Create Campaign
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {/* Active list cards */}
                                            {!pageIsLoading && !loadError && campaigns.length > 0 && (
                                                <div className="space-y-6">
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
                                                                initial={{ opacity: 0, y: 15 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                transition={{ delay: index * 0.05 }}
                                                                className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden mb-6"
                                                            >
                                                                {/* Top title and status details */}
                                                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                                                                    <div className="flex flex-wrap items-center gap-3">
                                                                        <h3 className="text-base font-bold text-white tracking-wide font-sans">{campaign.title}</h3>
                                                                        
                                                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                                                                            campaign.status === "ACTIVE"
                                                                                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                                                                : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                                                        }`}>
                                                                            {campaign.status === "ACTIVE" ? (
                                                                                <CheckCircle size={12} />
                                                                            ) : (
                                                                                <Pause size={12} />
                                                                            )}
                                                                            {campaign.status}
                                                                        </span>

                                                                        {campaign.isShielded && (
                                                                            <span
                                                                                title="Metadata-masked in SubScript's batch event log. On-chain USDC transfers remain public until Arc's Privacy Sector (APS) is live."
                                                                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#00d2b4]/10 border border-[#00d2b4]/20 text-[#00d2b4]"
                                                                            >
                                                                                <Shield size={12} />
                                                                                Confidential (Preview)
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {/* Action panel buttons */}
                                                                    <div className="flex gap-2 font-sans">
                                                                        <button
                                                                            className="px-3 py-1.5 rounded-lg bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 text-[#00d2b4] text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                                                            onClick={() => handleToggleStatus(campaign)}
                                                                            disabled={isToggling}
                                                                        >
                                                                            {isToggling ? (
                                                                                <Loader2 size={12} className="animate-spin" />
                                                                            ) : campaign.status === "ACTIVE" ? (
                                                                                <Pause size={12} />
                                                                            ) : (
                                                                                <Play size={12} />
                                                                            )}
                                                                            {campaign.status === "ACTIVE" ? "Pause" : "Resume"}
                                                                        </button>
                                                                        <button
                                                                            className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                                                            onClick={() => handleDelete(campaign.id)}
                                                                            disabled={isDeleting}
                                                                        >
                                                                            {isDeleting ? (
                                                                                <Loader2 size={12} className="animate-spin" />
                                                                            ) : (
                                                                                <Trash2 size={12} />
                                                                            )}
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* Campaign cycle stats details */}
                                                                <div className="flex flex-wrap gap-6 text-xs text-white/60 mb-4">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Clock size={14} className="text-white/30" />
                                                                        {frequencyLabel(campaign.frequencyDays)}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Calendar size={14} className={isOverdue ? "text-red-400" : "text-white/30"} />
                                                                        <span className={isOverdue ? "text-red-400 font-medium" : ""}>
                                                                            Next: {nextDate.toLocaleDateString("en-US", {
                                                                                month: "short",
                                                                                day: "numeric",
                                                                                year: "numeric",
                                                                            })}
                                                                            {isOverdue && " (overdue)"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Users size={14} className="text-white/30" />
                                                                        {campaign.recipients.length} recipient{campaign.recipients.length !== 1 ? "s" : ""}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <DollarSign size={14} className="text-white/30" />
                                                                        <span className="text-white font-semibold">
                                                                            {formatUsdc(totalMicro)} USDC
                                                                        </span>
                                                                        <span className="text-white/30">/ cycle</span>
                                                                    </div>
                                                                </div>

                                                                {/* Recipient breakdown list dropdown */}
                                                                {campaign.recipients.length > 0 && (
                                                                    <RecipientList recipients={campaign.recipients} />
                                                                )}
                                                            </motion.div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer wrapper */}
                    <footer className={embedded ? "hidden" : "mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4"}>
                        <span>© 2026 SubScript Protocol. All rights reserved.</span>
                        <div className="flex gap-4">
                            <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                            <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                        </div>
                        <span>Built on Arc Network</span>
                    </footer>
                </main>
            </div>

            {/* Modals and toast notifications */}
            <WithdrawModal
                isOpen={isWithdrawOpen}
                onClose={() => setIsWithdrawOpen(false)}
                vaultBalance={vaultBalance}
                connectedAddress={address || ""}
                payoutDestination={payoutDestination}
                onConfirmWithdraw={async (targetAddress) => {
                    await handleWithdraw(targetAddress);
                    setIsWithdrawOpen(false);
                }}
                isWithdrawing={isWithdrawing}
                isPremium={isPremium}
            />
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={!!embeddedWallet}
                depositAddress={address || ""}
                onSuccess={handleDepositSuccess}
                executeContractWrite={executeContractWrite}
            />

            {/* High-fidelity glassmorphic toast notification */}
            {toast.visible && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 liquid-glass border border-[#00d2b4]/30 bg-black/60 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-[0_8px_32px_0_rgba(0,210,180,0.25)] font-sans">
                    <Zap className="w-5 h-5 text-[#00d2b4] fill-[#00d2b4]/25 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                        {toast.message}
                    </span>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Recipient list sub-component                                       */
/* ------------------------------------------------------------------ */

function RecipientList({ recipients }: { recipients: PayrollCampaign["recipients"] }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="mt-4">
            <button
                onClick={() => setExpanded((prev) => !prev)}
                className="bg-transparent border-none text-white/50 hover:text-white text-xs cursor-pointer flex items-center gap-1.5 py-1 font-semibold uppercase tracking-wider transition-all"
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
                        className="overflow-hidden"
                    >
                        <div className="mt-3 bg-white/[0.01] rounded-2xl border border-white/5 p-4 font-sans">
                            {/* Table header */}
                            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 pb-2 border-b border-white/5 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 font-sans">
                                    Wallet
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 font-sans text-right">
                                    Amount
                                </span>
                            </div>

                            {/* Rows */}
                            {recipients.map((r) => (
                                <div
                                    key={r.id}
                                    className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 py-1.5 text-xs"
                                >
                                    <span className="text-white/60 font-mono truncate" title={r.employeeWallet}>
                                        {r.employeeAlias || (r.employeeWallet.startsWith("0x") && r.employeeWallet.length === 42 ? `${r.employeeWallet.slice(0, 6)}...${r.employeeWallet.slice(-4)}` : r.employeeWallet)}
                                    </span>
                                    <span className="text-white font-medium text-right">
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
