"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Fragment } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import MerchantDashboardNav from "@/components/dashboard/MerchantDashboardNav";
import MerchantOverview from "@/components/dashboard/MerchantOverview";
import NotificationBell from "@/components/dashboard/NotificationBell";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import Skeleton from "@/components/ui/Skeleton";
import { SkeletonCard, SkeletonRows, SkeletonStatGrid } from "@/components/ui/skeletons";
import { getDashboardUrl } from "@/utils/navigation";
import { buildCheckoutUrl, buildSubscribeUrl } from "@/lib/checkoutUrl";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import WithdrawModal from "@/components/WithdrawModal";
import DepositModal from "@/components/DepositModal";
import SendWalletModal from "@/components/SendWalletModal";
import QrScannerModal from "@/components/QrScannerModal";
import { resolveScannedTarget } from "@/lib/qr/scanTargets";
import ConfirmModal from "@/components/ConfirmModal";
import DurationPicker from "@/components/DurationPicker";
import KycVerificationPanel from "@/components/KycVerificationPanel";
import SupportChatModal from "@/components/support/SupportChatModal";
import { useAccount, useConnect, useDisconnect, useWriteContract, useSwitchChain, useReadContract, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import {
    createPublicClient,
    http,
    formatUnits,
    parseUnits,
} from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, CheckCircle, AlertTriangle,
    PlugZap, Loader2, Award, Crown, ExternalLink, ArrowDownToLine,
    Wallet, Shield, BarChart3, Link2, Zap, QrCode, Lock, Building2,
    Play, Pause, Trash2, Globe, ArrowDown, ArrowUpRight, ArrowUp, ChevronDown, ChevronRight, User, Share2,
    ShieldCheck, Save, SquaresFour, MessageSquare, HelpCircle, Send, Terminal, Bell, Search, ChevronLeft, ArrowLeft
} from "@/components/icons";
import { useTheme } from "@/hooks/useTheme";
import { useSwipeTabs } from "@/hooks/useSwipeTabs";
import { QRCode } from "react-qrcode-logo";
import type { MerchantAnalyticsSummary, MerchantSubscriptionDetail } from "@/lib/analytics/merchantSubscriptions";
import { PayrollContent } from "@/app/dashboard/payroll/PayrollContent";

import {
    PREMIUM_PLAN_ID,
    SUBSCRIPT_ROUTER_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS,
    CONFIDENTIAL_CONTRACT_ADDRESS
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, SUBSCRIPT_ROUTER_ABI, USDC_ERC20_ABI, CONFIDENTIAL_CONTRACT_ABI } from "@/lib/contracts/abis";
import FinancialStatusBadge from "@/components/FinancialStatusBadge";

const TEST_PUBLISHABLE_KEY = "pk_test_51Px9800Z7Z4M19XQY1R93B";

const publicClient = createPublicClient({
    chain: activeArcChain,
    transport: arcHttp(),
});

const ERC20_ABI = USDC_ERC20_ABI;
const ROUTER_ABI = SUBSCRIPT_ROUTER_ABI;
const STANDARD_ABI = STANDARD_SUBSCRIPT_ABI;


const tabs = [
    { id: "overview", label: "Overview", icon: SquaresFour },
    { id: "payment-links", label: "Payments", icon: Sliders },
    { id: "payroll", label: "Payroll", icon: Building2 },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "premium", label: "Premium Pro", icon: Crown },
    { id: "settings", label: "Profile & DNS", icon: User },
] as const;


type TabId = "overview" | "premium" | "payment-links" | "plans" | "apikeys" | "checkout" | "webhooks" | "settings" | "payroll" | "offramp";

type MerchantSubView =
    | "menu"
    | "profile"
    | "appearance"
    | "dns"
    | "kyc"
    | "dunning"
    | "transactions"
    | "notifications"
    | "security"
    | "support";

type MerchantPlan = {
    id: string;
    targetSubscriber?: string | null;
    merchantAddress: string;
    name: string;
    description?: string | null;
    detailsUrl?: string | null;
    amountUsdc: string;
    periodSeconds: string;
    active: boolean;
};

type PlanPromotion = {
    id: string;
    planId: string;
    name: string;
    discountType: string;
    discountBps: number | null;
    regularAmountUsdc: string;
    introductoryAmountUsdc: string;
    introductoryCycles: number;
    startsAt: string | null;
    expiresAt: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    newCustomersOnly: boolean;
    active: boolean;
};

const PLAN_DESCRIPTION_MAX = 300;

const formatApiKeyFingerprint = (value: string | null | undefined) => {
    if (!value) return null;
    if (value.includes("...")) return value;
    if (value.length <= 12) return "••••••••";
    return `${value.slice(0, 12)}...${value.slice(-4)}`;
};

const formatPlanAmount = (micros: string) => {
    try {
        return Number(formatUnits(BigInt(micros), 6)).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        return "0.00";
    }
};

const limitDecimals = (value: string, maxDecimals: number = 6): string => {
    if (!value || !value.includes(".")) return value;
    const [integer, fraction] = value.split(".");
    return `${integer}.${fraction.slice(0, maxDecimals)}`;
};

const formatPlanPeriod = (seconds: string) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "cycle";
    const days = Math.round(value / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
};

const formatUsdcMicros = (value: any) => {
    try {
        const micros = BigInt(String(value ?? "0"));
        const unit = BigInt(1_000_000);
        const sign = micros < BigInt(0) ? "-" : "";
        const absolute = micros < BigInt(0) ? -micros : micros;
        const whole = absolute / unit;
        const fraction = (absolute % unit).toString().padStart(6, "0").slice(0, 2);
        return `${sign}${whole.toString()}.${fraction}`;
    } catch {
        return "0.00";
    }
};


const microsToNumber = (value: any) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const shortenHash = (value: string | undefined) => {
    if (!value) return "";
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const comingSoonMerchantSettings = new Set([
    "pushEnabled",
    "emailEnabled",
    "payoutSettlementEnabled",
    "disputeAlertsEnabled",
    "securityMultiSigEnabled",
]);

export default function DashboardPage() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const { address: realAddress, isConnected: realIsConnected, chainId } = useAccount();
    const { connect, connectors, error: connectError, isError: isConnectError, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const { switchChain, switchChainAsync } = useSwitchChain();
    /* Soulbound Access Key (SBT) State removed because SBT infrastructure is deleted */

    /* Payment Links States */
    const [paymentLinks, setPaymentLinks] = useState<any[]>([]);
    const [isLinksLoading, setIsLinksLoading] = useState(false);
    const [initialLinksFetched, setInitialLinksFetched] = useState(false);
    const [merchantPlans, setMerchantPlans] = useState<MerchantPlan[]>([]);
    const [planPromotions, setPlanPromotions] = useState<PlanPromotion[]>([]);
    const [isPlansLoading, setIsPlansLoading] = useState(false);
    const [initialPlansFetched, setInitialPlansFetched] = useState(false);
    const [planName, setPlanName] = useState("");
    const [planDescription, setPlanDescription] = useState("");
    const [planDetailsUrl, setPlanDetailsUrl] = useState("");
    const [planAmountUsdc, setPlanAmountUsdc] = useState("");
    const [planPeriodDays, setPlanPeriodDays] = useState("30");
    const [planError, setPlanError] = useState<string | null>(null);
    const [planSuccess, setPlanSuccess] = useState<string | null>(null);

    const [linkTitle, setLinkTitle] = useState("");
    const [linkDescription, setLinkDescription] = useState("");
    const [linkAmountUsdc, setLinkAmountUsdc] = useState("");
    const [linkDurationMinutes, setLinkDurationMinutes] = useState(1440); /* Default to 24 hours (1440 mins) */
    const [linkExternalReference, setLinkExternalReference] = useState("");
    const [linkMaxUses, setLinkMaxUses] = useState("1");
    const [linkInvoiceNumber, setLinkInvoiceNumber] = useState("");
    const [linkDueDate, setLinkDueDate] = useState("");
    const [linkPayerEmail, setLinkPayerEmail] = useState("");

    /* Configurable dunning: failed renewal attempts before the keeper stops a customer sub. */
    const [dunningMaxFailures, setDunningMaxFailures] = useState("4");
    const [dunningLoaded, setDunningLoaded] = useState(false);
    const [dunningSaving, setDunningSaving] = useState(false);
    const [dunningMessage, setDunningMessage] = useState<string | null>(null);
    const [isCreatingLink, setIsCreatingLink] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
    const [createdLinkInfo, setCreatedLinkInfo] = useState<{ id: string; title: string; checkoutUrl: string } | null>(null);
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState("");
    const [confirmModal, setConfirmModal] = useState<{
        open: boolean;
        title: string;
        description: string;
        confirmLabel: string;
        cancelLabel?: string;
        variant: "danger" | "warning" | "default";
        onConfirm: () => void;
        onCancel?: () => void;
    } | null>(null);
    const [linkCopyFeedback, setLinkCopyFeedback] = useState<{ [id: string]: boolean }>({});
    const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);
    const [showLinkAdvanced, setShowLinkAdvanced] = useState(true);
    const [showCheckoutAdvanced, setShowCheckoutAdvanced] = useState(false);
    const [walletProvider, setWalletProvider] = useState("none");
    const [dbProvider, setDbProvider] = useState("none");
    const [sessionProvider, setSessionProvider] = useState("none");
    const [ledgerPage, setLedgerPage] = useState(0);
    const [ledgerCursors, setLedgerCursors] = useState<Array<string | null>>([null]);
    const [linksPage, setLinksPage] = useState(0);
    const [webhooksPage, setWebhooksPage] = useState(0);

    const [premiumSubId, setPremiumSubId] = useState<number | null>(null);
    const [isCancellingPremium, setIsCancellingPremium] = useState(false);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [isResumingPremium, setIsResumingPremium] = useState(false);
    const [dbSubscriptionStatus, setDbSubscriptionStatus] = useState<string | null>(null);
    const [downgradeFailures, setDowngradeFailures] = useState<number>(0);


    const [embeddedWallet, setEmbeddedWallet] = useState<{ wallet: string; email: string } | null>(null);
    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [otpEmail, setOtpEmail] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpSuccess, setOtpSuccess] = useState(false);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [rememberMe, setRememberMe] = useState(true);
    const pendingRequestIdsRef = useRef<Record<string, string>>({});

    const activeMerchantAddress = useMemo(() => {
        return embeddedWallet?.wallet || realAddress || sessionWallet || "";
    }, [embeddedWallet, realAddress, sessionWallet]);

    const isConnected = realIsConnected || !!embeddedWallet || !!sessionWallet;
    const address = activeMerchantAddress;

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

            if (functionName === "cancelSubscription") {
                action = "cancelSubscription";
                serializedArgs = { subscriptionId: args[0].toString() };
            } else if (functionName === "createSubscription") {
                action = "createPremiumSubscription";
                serializedArgs = {
                    merchant: args[0],
                    amount: args[1].toString(),
                    period: args[2].toString(),
                };
            } else if (functionName === "withdraw") {
                action = "withdraw";
                serializedArgs = {};
            } else if (functionName === "withdrawTo") {
                action = "withdraw";
                serializedArgs = { to: args[0] };
            } else if (functionName === "transfer") {
                action = "transferUsdc";
                serializedArgs = { to: args[0], amount: args[1].toString() };
            } else if (functionName === "configurePayoutDestination") {
                action = "configurePayoutDestination";
                serializedArgs = { payoutAddress: args[0] };
            } else if (functionName === "approve") {
                action = "approveUsdc";
                serializedArgs = { spender: args[0], amount: args[1].toString() };
            } else if (functionName === "registerViewKey") {
                action = "registerViewKey";
                serializedArgs = { viewKeyHash: args[0] };
            } else {
                throw new Error(`Execution intent not allowlisted for embedded wallets: ${functionName}`);
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            const FINANCIAL_ACTIONS = new Set(["transferUsdc", "createPremiumSubscription", "withdraw"]);
            if (FINANCIAL_ACTIONS.has(action)) {
                if (!pendingRequestIdsRef.current[action]) {
                    pendingRequestIdsRef.current[action] = crypto.randomUUID();
                }
                headers["x-request-id"] = pendingRequestIdsRef.current[action];
            }
            const res = await fetch("/api/execute-tx", {
                method: "POST",
                headers,
                body: JSON.stringify({ action, args: serializedArgs }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Server transaction execution failed");
            }
            delete pendingRequestIdsRef.current[action];
            return data.txHash as string;
        } else {
            if (chainId !== activeArcChain.id) {
                if (switchChainAsync) {
                    await switchChainAsync({ chainId: activeArcChain.id });
                } else if (switchChain) {
                    switchChain({ chainId: activeArcChain.id });
                }
            }
            return await writeContractAsync({
                address: contractAddress as `0x${string}`,
                abi: contractAbi,
                functionName,
                args,
            });
        }
    };


    const [premiumStatus, setPremiumStatus] = useState<string | null>(null);
    const [premiumError, setPremiumError] = useState<string | null>(null);
    const [rerouteAddress, setRerouteAddress] = useState("");
    const [isRerouting, setIsRerouting] = useState(false);
    const [rerouteSuccess, setRerouteSuccess] = useState(false);
    const [isTriggeringKeeper, setIsTriggeringKeeper] = useState(false);
    const [keeperStatus, setKeeperStatus] = useState<string | null>(null);
    const [keeperError, setKeeperError] = useState<string | null>(null);

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== "undefined") {
            /* Check for upgrade success and show toast */
            const urlParams = new URLSearchParams(window.location.search);
            const tabParam = urlParams.get("tab");
            if (tabParam && (tabs.some(t => t.id === tabParam) || tabParam === "offramp" || tabParam === "plans")) {
                setActiveTab(tabParam as TabId);
            }
            if (urlParams.get("upgradeSuccess") === "true") {
                setToastMessage("Premium Pro activated");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 4000);
                /* Clean up URL parameter to avoid showing the toast again on refresh */
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            const scrollParam = urlParams.get("scroll");
            if (scrollParam === "dns") {
                setActiveTab("settings");
            }
        }
    }, [realAddress, realIsConnected]);

    /* Detect browser local currency and fetch real-time exchange rate */
    useEffect(() => {
        if (typeof window === "undefined") return;

        const detectLocalCurrency = () => {
            try {
                const locale = navigator.language || "en-US";
                const parts = locale.split("-");
                const country = parts[1] ? parts[1].toUpperCase() : "";
                
                const countryToCurrency: Record<string, { code: string; symbol: string }> = {
                    NG: { code: "NGN", symbol: "₦" },
                    GB: { code: "GBP", symbol: "£" },
                    DE: { code: "EUR", symbol: "€" },
                    FR: { code: "EUR", symbol: "€" },
                    IT: { code: "EUR", symbol: "€" },
                    ES: { code: "EUR", symbol: "€" },
                    NL: { code: "EUR", symbol: "€" },
                    JP: { code: "JPY", symbol: "¥" },
                    IN: { code: "INR", symbol: "₹" },
                    AU: { code: "AUD", symbol: "A$" },
                    CA: { code: "CAD", symbol: "C$" },
                    US: { code: "USD", symbol: "$" },
                    ZA: { code: "ZAR", symbol: "R" },
                    KE: { code: "KES", symbol: "KSh" },
                    GH: { code: "GHS", symbol: "GH₵" },
                };
                
                if (country && countryToCurrency[country]) {
                    return countryToCurrency[country];
                }
                
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
                if (tz.includes("Lagos")) return { code: "NGN", symbol: "₦" };
                if (tz.includes("London")) return { code: "GBP", symbol: "£" };
                if (tz.includes("Europe")) return { code: "EUR", symbol: "€" };
                if (tz.includes("Calcutta") || tz.includes("Kolkata")) return { code: "INR", symbol: "₹" };
                if (tz.includes("Tokyo")) return { code: "JPY", symbol: "¥" };
                if (tz.includes("Sydney") || tz.includes("Melbourne")) return { code: "AUD", symbol: "A$" };
                if (tz.includes("Toronto") || tz.includes("Vancouver")) return { code: "CAD", symbol: "C$" };
                if (tz.includes("Nairobi")) return { code: "KES", symbol: "KSh" };
                if (tz.includes("Accra")) return { code: "GHS", symbol: "GH₵" };
                if (tz.includes("Johannesburg")) return { code: "ZAR", symbol: "R" };
                
            } catch (e) {
                console.error("Failed to detect currency from locale/timezone fallback:", e);
            }
            return { code: "USD", symbol: "$" };
        };

        const initialCurrency = detectLocalCurrency();
        setDetectedCurrency(initialCurrency);

        const fetchGeoCurrencyAndRate = async () => {
            try {
                const res = await fetch(`/api/rates?currency=${encodeURIComponent(initialCurrency.code)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        const resolvedCode = data.currency || initialCurrency.code;
                        const resolvedSymbol = resolvedCode === "NGN" ? "₦" : (data.symbol && data.symbol !== "E" ? data.symbol : initialCurrency.symbol);
                        setDetectedCurrency({
                            code: resolvedCode,
                            symbol: resolvedSymbol
                        });
                        setExchangeRate(Number(data.rate) || 1.0);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch exchange rates from local API:", e);
            }
        };

        fetchGeoCurrencyAndRate();
    }, []);

    const [merchantTier, setMerchantTier] = useState(0);
    const [vaultBalance, setVaultBalance] = useState(0);
    const [payoutDestination, setPayoutDestination] = useState<string | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
    const [isPremium, setIsPremium] = useState(false);
    const [supportChatOpen, setSupportChatOpen] = useState(false);
    const [promptFlowMode, setPromptFlowMode] = useState<"standard" | "private">("standard");
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
    const [isSendWalletOpen, setIsSendWalletOpen] = useState(false);
    const [isSendingWallet, setIsSendingWallet] = useState(false);
    const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
    const [scannedRecipient, setScannedRecipient] = useState("");

    /* Currency detection and real-time exchange rate states */
    const [detectedCurrency, setDetectedCurrency] = useState<{ code: string; symbol: string }>({ code: "USD", symbol: "$" });
    const [exchangeRate, setExchangeRate] = useState<number>(1.0);

    /* Confidentiality states */
    const [sessionAlert, setSessionAlert] = useState<"role_missing" | "wrong_role" | "wallet_mismatch" | null>(null);
    const [shieldedEnabled, setShieldedEnabled] = useState(false);
    const [viewKey, setViewKey] = useState("");
    const [isViewKeyRegistered, setIsViewKeyRegistered] = useState(false);
    const [showViewKey, setShowViewKey] = useState(false);
    const [copiedViewKey, setCopiedViewKey] = useState(false);
    const [isSavingConfidentiality, setIsSavingConfidentiality] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [settlementTimeframe, setSettlementTimeframe] = useState<string>('6M');
    const [balanceVisible, setBalanceVisible] = useState(true);
    const [timeframeOpen, setTimeframeOpen] = useState(false);
    const [fiatSplit, setFiatSplit] = useState(50);

    /* QR Code modal states */
    const [activeQrCodeLink, setActiveQrCodeLink] = useState<string | null>(null);
    const [activeQrCodeTitle, setActiveQrCodeTitle] = useState("");

    /* SubScript Alias DNS states */
    const [merchantAlias, setMerchantAlias] = useState<string | null>(null);
    const [merchantAliasIsAnonymous, setMerchantAliasIsAnonymous] = useState(false);
    const [aliasInput, setAliasInput] = useState("");
    const [aliasIsAnonymousInput, setAliasIsAnonymousInput] = useState(false);
    const [isSavingAlias, setIsSavingAlias] = useState(false);
    const [aliasSuccessMessage, setAliasSuccessMessage] = useState<string | null>(null);
    const [aliasErrorMessage, setAliasErrorMessage] = useState<string | null>(null);



    /* Tier and confidentiality come from the database, and must not sit downstream of the chain
       reads. All of this used to share ONE try block, with the API fetches sequenced after a
       Promise.all of four Arc calls — and Arc's public RPC rate-limits per call while viem does not
       retry its 429s (see lib/arc/transport). A single collision rejected the Promise.all and threw
       before setIsPremium ever ran, so isPremium stayed false and a paying merchant was shown the
       upgrade lock over their own API keys, checkout and webhooks. The retrying transport makes that
       far less likely; independence makes it harmless. A chain hiccup may cost you a balance — it
       must never cost you your tier. */
    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;

        const loadTier = async () => {
            try {
                const tierRes = await fetch(`/api/merchant/tier?address=${address}`);
                if (!tierRes.ok) return;
                const tierData = await tierRes.json();
                setIsPremium(Number(tierData.tier) >= 1);
                setMerchantTier(Number(tierData.tier));
                setPremiumSubId(tierData.subscriptionId ? Number(tierData.subscriptionId) : null);
                setCancelAtPeriodEnd(!!tierData.cancelAtPeriodEnd);
                setCurrentPeriodEnd(tierData.nextBillingDate || null);
                setDbSubscriptionStatus(tierData.status || null);
                setDowngradeFailures(tierData.downgradeFailures ? Number(tierData.downgradeFailures) : 0);
            } catch (error) {
                console.error("Error loading merchant tier:", error);
            }
        };

        const loadConfidentiality = async () => {
            try {
                const confidentialityRes = await fetch("/api/merchant/confidentiality");
                if (!confidentialityRes.ok) return;
                const confData = await confidentialityRes.json();
                setShieldedEnabled(!!confData.shielded_payouts_enabled);
                setIsViewKeyRegistered(!!confData.view_key_hash);
            } catch (error) {
                console.error("Error loading confidentiality settings:", error);
            }
        };

        const loadChainState = async () => {
            try {
                /* merchantTiers was read here too and never used — the tier below is the DB's. It was
                   a fourth call into the limiter for nothing. */
                const [vaultRaw, payoutRaw, walletRaw] = await Promise.all([
                    publicClient.readContract({
                        address: SUBSCRIPT_ROUTER_ADDRESS,
                        abi: ROUTER_ABI,
                        functionName: "merchantBalances",
                        args: [address as `0x${string}`],
                    }),
                    publicClient.readContract({
                        address: SUBSCRIPT_ROUTER_ADDRESS,
                        abi: ROUTER_ABI,
                        functionName: "merchantPayoutDestination",
                        args: [address as `0x${string}`],
                    }),
                    publicClient.readContract({
                        address: USDC_NATIVE_GAS_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: "balanceOf",
                        args: [address as `0x${string}`],
                    }),
                ]);

                setVaultBalance(parseFloat(formatUnits(vaultRaw, 6)));
                setPayoutDestination(payoutRaw && payoutRaw !== "0x0000000000000000000000000000000000000000" ? payoutRaw : null);
                setWalletBalance(parseFloat(formatUnits(walletRaw as bigint, 6)));
            } catch (error) {
                console.error("Error reading contract data in background:", error);
            }
        };

        await Promise.all([loadTier(), loadConfidentiality(), loadChainState()]);
    }, [address]);

    const handleDepositSuccess = () => {
        refetchBalancesAndTier();
    };

    useEffect(() => {
        if (!address) return;
        refetchBalancesAndTier();
        const interval = setInterval(refetchBalancesAndTier, 8000);
        return () => clearInterval(interval);
    }, [address, refetchBalancesAndTier]);

    useEffect(() => {
        if (typeof window !== "undefined" && address) {
            const storedKey = sessionStorage.getItem(`subscript_viewkey_${address.toLowerCase()}`);
            if (storedKey) {
                setViewKey(storedKey);
            } else {
                setViewKey("");
            }
        }
    }, [address]);

    /* useEffect for SBT metadata fetching removed */



    const refetchTier = refetchBalancesAndTier;
    const refetchVaultBalance = refetchBalancesAndTier;
    const refetchPayoutDest = refetchBalancesAndTier;
    const refetchWalletBalance = refetchBalancesAndTier;

    const handleManualRefreshBalances = async () => {
        setIsRefreshingBalances(true);
        try {
            await refetchBalancesAndTier();
        } catch (err) {
            console.error("Failed to refresh balances manually:", err);
        } finally {
            setIsRefreshingBalances(false);
        }
    };


    const { theme, setTheme, resolvedTheme } = useTheme();
    const [merchantSubView, setMerchantSubView] = useState<MerchantSubView>("menu");
    const [activeTab, setActiveTab] = useState<TabId>("overview");

    /* A tab switch always starts at the top — otherwise a scroll depth carried over
       from a longer tab can sit past the end of a shorter one, showing only background. */
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeTab]);

    /* Load the dunning config lazily, the first time the settings tab opens. */
    useEffect(() => {
        if (activeTab !== "settings" || dunningLoaded) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/merchant/dunning");
                const data = await res.json().catch(() => ({}));
                if (!cancelled && res.ok && data.success) {
                    setDunningMaxFailures(String(data.dunning.maxFailures));
                    setDunningLoaded(true);
                }
            } catch { /* keep the default; the card still saves */ }
        })();
        return () => { cancelled = true; };
    }, [activeTab, dunningLoaded]);

    const handleSaveDunning = async () => {
        const value = Number(dunningMaxFailures);
        if (!Number.isInteger(value) || value < 1 || value > 10) {
            setDunningMessage("Choose a whole number between 1 and 10.");
            return;
        }
        setDunningSaving(true);
        setDunningMessage(null);
        try {
            const res = await fetch("/api/merchant/dunning", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ maxFailures: value }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to save");
            setDunningMessage("Saved. Applies from the next billing run.");
            setTimeout(() => setDunningMessage(null), 4000);
        } catch (err: any) {
            setDunningMessage(err.message || "Failed to save dunning settings.");
        } finally {
            setDunningSaving(false);
        }
    };
    const [subTab, setSubTab] = useState<"subscriptions" | "one-time" | "commit">("subscriptions");
    const paymentSubTabsSwipe = useSwipeTabs(["subscriptions", "one-time", "commit"] as const, subTab, setSubTab);
    const [vaults, setVaults] = useState<any[]>([]);
    const [isVaultsLoading, setIsVaultsLoading] = useState(false);
    const [claimableAmount, setClaimableAmount] = useState("0");
    const [isVaultOpsLoading, setIsVaultOpsLoading] = useState(false);
    const [isClaimingVault, setIsClaimingVault] = useState(false);
    const [vaultOpsStatus, setVaultOpsStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [usageSecretKey, setUsageSecretKey] = useState("");
    const [selectedApiKey, setSelectedApiKey] = useState("");

    const [vaultsError, setVaultsError] = useState<string | null>(null);
    const fetchVaults = useCallback(async () => {
        setIsVaultsLoading(true);
        setVaultsError(null);
        try {
            const res = await fetch("/api/user/vault/config");
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                setVaults(data.vaults || []);
            } else {
                /* Don't render "no customers yet" over a failed load — that reads as
                   real business data (zero escrows) when it's actually an error. */
                setVaultsError(data?.error || "Customer escrows could not be loaded. Retry with Refresh.");
            }
        } catch (err) {
            console.error("Failed to load customer vaults:", err);
            setVaultsError("Customer escrows could not be loaded. Retry with Refresh.");
        } finally {
            setIsVaultsLoading(false);
        }
    }, []);

    const fetchVaultOps = useCallback(async () => {
        setIsVaultOpsLoading(true);
        try {
            const claimRes = await fetch("/api/merchant/vault/claim");
            const claimData = await claimRes.json().catch(() => null);

            if (claimRes.ok && claimData?.success) {
                setClaimableAmount(claimData.claimableUsdc || "0");
            }
            if (!claimRes.ok) {
                setVaultOpsStatus({
                    text: claimData?.error || "Vault controls could not be loaded.",
                    type: "error"
                });
            }
        } catch (err) {
            console.error("Failed to load merchant vault controls:", err);
        } finally {
            setIsVaultOpsLoading(false);
        }
    }, []);

    const fetchVaultApiKeys = useCallback(async () => {
        try {
            const res = await fetch("/api/merchant/api-keys");
            if (res.ok) {
                const data = await res.json();
                const keys = data.keys || [];
                const usableKey = keys.find((key: any) => key.secretKeyAvailable && key.secretKeyPlain);
                if (usableKey) {
                    setSelectedApiKey(usableKey.secretKeyPlain);
                } else {
                    setSelectedApiKey("");
                }
            }
        } catch (err) {
            console.error("Failed to load API keys:", err);
        }
    }, []);

    useEffect(() => {
        if (activeTab === "payment-links" && subTab === "commit" && isPremium && address) {
            fetchVaults();
            fetchVaultOps();
            fetchVaultApiKeys();
        }
    }, [activeTab, subTab, isPremium, address, fetchVaults, fetchVaultOps, fetchVaultApiKeys]);

    const handleClaimVaultFunds = async () => {
        setIsClaimingVault(true);
        setVaultOpsStatus(null);
        try {
            const res = await fetch("/api/merchant/vault/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                setVaultOpsStatus({
                    text: `Funds claimed successfully. Tx ${shortenHash(data.txHash)}.`,
                    type: "success"
                });
                setClaimableAmount("0");
                fetchVaultOps();
                handleManualRefreshBalances();
            } else {
                setVaultOpsStatus({ text: data?.error || "Failed to claim settled funds.", type: "error" });
            }
        } catch (err: any) {
            setVaultOpsStatus({ text: err.message || "Failed to claim settled funds.", type: "error" });
        } finally {
            setIsClaimingVault(false);
        }
    };

    const [userSettings, setUserSettings] = useState<any>(null);
    const [settingsTransactions, setSettingsTransactions] = useState<any[]>([]);
    const [settingsTxCategory, setSettingsTxCategory] = useState<string>("all");
    const [settingsTxStatus, setSettingsTxStatus] = useState<string>("all");
    const [settingsTxDatePreset, setSettingsTxDatePreset] = useState<string>("all");
    const [settingsTxStartDate, setSettingsTxStartDate] = useState<string>("");
    const [settingsTxEndDate, setSettingsTxEndDate] = useState<string>("");
    const [settingsTxSearch, setSettingsTxSearch] = useState<string>("");
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [dnsDomain, setDnsDomain] = useState("");
    const [dnsSuffix, setDnsSuffix] = useState(".hq");
    const [dnsConfirmPending, setDnsConfirmPending] = useState<string | null>(null);
    const [merchantAliasNextChange, setMerchantAliasNextChange] = useState<string | null>(null);
    const [dnsLoading, setDnsLoading] = useState(false);
    const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
    const [dnsError, setDnsError] = useState<string | null>(null);
    const [uploadingPic, setUploadingPic] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [savingSettingsField, setSavingSettingsField] = useState<string | null>(null);
    const [payoutDestinationDraft, setPayoutDestinationDraft] = useState("");
    const [payoutDestinationError, setPayoutDestinationError] = useState<string | null>(null);
    const savedPayoutDestination = userSettings?.payoutDestination || "";

    useEffect(() => {
        if (userSettings) setPayoutDestinationDraft(savedPayoutDestination);
    }, [savedPayoutDestination, userSettings]);
    const [churnQuestionDraft, setChurnQuestionDraft] = useState("");
    const [merchantWalletBackupLoading, setMerchantWalletBackupLoading] = useState(false);
    const [merchantWalletBackupError, setMerchantWalletBackupError] = useState<string | null>(null);
    const [merchantExportOtpStage, setMerchantExportOtpStage] = useState(false);
    const [merchantExportOtpCode, setMerchantExportOtpCode] = useState("");
    const [merchantExportOtpSending, setMerchantExportOtpSending] = useState(false);
    const [merchantExportedPrivateKey, setMerchantExportedPrivateKey] = useState<string | null>(null);
    const [merchantPrivateKeyVisible, setMerchantPrivateKeyVisible] = useState(false);

    const fetchSettings = useCallback(async () => {
        if (!address) return;
        setIsSettingsLoading(true);
        try {
            const res = await fetch("/api/user/settings");
            const data = await res.json();
            if (data.success) {
                setUserSettings(data.settings);
                setChurnQuestionDraft(data.settings?.churnSurveyQuestion || "");
                setSettingsTransactions(data.receipts);
                if (data.settings.alias) {
                    const aliasParts = data.settings.alias.split(".");
                    setDnsDomain(aliasParts[0]);
                    setDnsSuffix("." + (aliasParts[1] || "hq"));
                }
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        } finally {
            setIsSettingsLoading(false);
        }
    }, [address]);

    useEffect(() => {
        if (address) {
            fetchSettings();
        }
    }, [address, fetchSettings]);

    const requestMerchantExportOtp = async () => {
        const email = userSettings?.walletBackup?.email || embeddedWallet?.email;
        if (!email) {
            setMerchantWalletBackupError("No verified email is linked to this merchant wallet.");
            return;
        }
        setMerchantExportOtpSending(true);
        setMerchantWalletBackupError(null);
        setMerchantExportedPrivateKey(null);
        setMerchantPrivateKeyVisible(false);
        try {
            const res = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Could not send a verification code.");
            }
            setMerchantExportOtpStage(true);
            setMerchantExportOtpCode("");
            setToastMessage(`Verification code sent to ${email}`);
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
        } catch (error: any) {
            setMerchantWalletBackupError(error.message || "Could not send a verification code.");
        } finally {
            setMerchantExportOtpSending(false);
        }
    };

    const handleMerchantWalletExport = async () => {
        setMerchantWalletBackupLoading(true);
        setMerchantWalletBackupError(null);
        try {
            const res = await fetch("/api/user/wallet/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ otpCode: merchantExportOtpCode.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Could not export this merchant wallet.");
            }
            setMerchantExportedPrivateKey(data.privateKey);
            setMerchantPrivateKeyVisible(true);
            setMerchantExportOtpStage(false);
            setMerchantExportOtpCode("");
        } catch (error: any) {
            setMerchantWalletBackupError(error.message || "Could not export this merchant wallet.");
        } finally {
            setMerchantWalletBackupLoading(false);
        }
    };

    const downloadMerchantWalletBackup = () => {
        if (!merchantExportedPrivateKey || !address) return;
        const blob = new Blob([[
            "SubScript merchant wallet private key backup",
            `Wallet: ${address.toLowerCase()}`,
            `Created: ${new Date().toISOString()}`,
            "",
            merchantExportedPrivateKey,
            "",
            "Store this offline. Anyone with this key can control this wallet.",
        ].join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `subscript-merchant-wallet-${address.slice(2, 8).toLowerCase()}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleToggleSetting = async (field: string, currentValue: boolean) => {
        if (comingSoonMerchantSettings.has(field)) return;
        setSavingSettingsField(field);
        try {
            const res = await fetch("/api/user/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [field]: !currentValue })
            });
            const data = await res.json();
            if (data.success) {
                setUserSettings((prev: any) => ({ ...prev, [field]: !currentValue }));
            }
        } catch (err) {
            console.error(`Error saving setting ${field}:`, err);
        } finally {
            setSavingSettingsField(null);
        }
    };

    const handleUpdateChurnSurveyQuestion = async (question: string) => {
        setSavingSettingsField("churnSurveyQuestion");
        try {
            const res = await fetch("/api/user/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ churnSurveyQuestion: question })
            });
            const data = await res.json();
            if (data.success) {
                const trimmed = question.trim();
                setUserSettings((prev: any) => ({ ...prev, churnSurveyQuestion: trimmed.length > 0 ? trimmed : null }));
                setToastMessage("Exit-survey question saved");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
            } else {
                setToastMessage(data.error || "Could not save the exit-survey question");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
            }
        } catch (err) {
            console.error("Error updating churn survey question:", err);
        } finally {
            setSavingSettingsField(null);
        }
    };

    const handleUpdatePayoutDestination = async (destination: string) => {
        const normalized = destination.trim();
        if (normalized && !ethers.isAddress(normalized)) {
            setPayoutDestinationError("Enter a valid EVM wallet address before saving.");
            return;
        }
        setConfirmModal({
            open: true,
            title: "Update Payout Destination",
            description: `Save ${normalized || "no address"} as the default payout destination? This changes the saved destination but does not move funds now.`,
            confirmLabel: "Save",
            variant: "warning",
            onConfirm: async () => {
                setConfirmModal(null);
                setSavingSettingsField("payoutDestination");
                setPayoutDestinationError(null);
                try {
                    const res = await fetch("/api/user/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ payoutDestination: normalized })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setUserSettings((prev: any) => ({ ...prev, payoutDestination: normalized }));
                        setToastMessage("Payout destination updated");
                        setShowToast(true);
                        setTimeout(() => setShowToast(false), 3000);
                    } else {
                        setPayoutDestinationError(data.error || "Could not save the payout destination.");
                    }
                } catch (err) {
                    console.error("Error updating payout destination:", err);
                    setPayoutDestinationError("Network error. Your previous payout destination is still saved.");
                } finally {
                    setSavingSettingsField(null);
                }
            },
        });
    };

    const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            setUploadError("Image size must be smaller than 2MB");
            return;
        }

        setUploadingPic(true);
        setUploadError(null);

        const reader = new FileReader();
        reader.onloadend = async () => {
            try {
                const res = await fetch("/api/user/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profilePic: reader.result })
                });
                const data = await res.json();
                if (data.success) {
                    setUserSettings((prev: any) => ({ ...prev, profilePic: reader.result as string }));
                } else {
                    setUploadError(data.error || "Upload failed");
                }
            } catch (err) {
                console.error("Error uploading profile pic:", err);
                setUploadError("Upload failed");
            } finally {
                setUploadingPic(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleRegisterDns = (e: React.FormEvent) => {
        e.preventDefault();
        setDnsError(null);
        setDnsSuccess(null);

        const prefix = dnsDomain.trim().toLowerCase();
        if (!prefix) {
            setDnsError("DNS alias cannot be empty");
            return;
        }
        const cleanPrefix = prefix.split(".")[0];
        /* Show a branded confirmation step (the name is locked for 365 days after this). */
        setDnsConfirmPending(`${cleanPrefix}${dnsSuffix}`);
    };

    const confirmDnsRegistration = async () => {
        const fullAlias = dnsConfirmPending;
        if (!fullAlias) return;
        setDnsLoading(true);
        setDnsError(null);
        setDnsSuccess(null);
        try {
            const res = await fetch("/api/merchant/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alias: fullAlias })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setDnsSuccess(`DNS Registered: ${fullAlias}`);
                setUserSettings((prev: any) => ({ ...prev, alias: fullAlias }));
                setMerchantAlias(fullAlias);
                setDnsConfirmPending(null);
            } else {
                setDnsError(data.error || "Registration failed");
            }
        } catch (err) {
            console.error("Error registering DNS:", err);
            setDnsError("Registration failed");
        } finally {
            setDnsLoading(false);
        }
    };


    const [copiedText, setCopiedText] = useState<string | null>(null);

    const [isAuthLoading, setIsAuthLoading] = useState(true);
    
    /* Loading states for initial fetches to support skeleton loading */
    const [initialKeysFetched, setInitialKeysFetched] = useState(false);
    const [initialWebhooksFetched, setInitialWebhooksFetched] = useState(false);
    const [initialEventsFetched, setInitialEventsFetched] = useState(false);
    const [initialContractFetched, setInitialContractFetched] = useState(false);

    const isLoading = !isMounted || isAuthLoading || (isConnected && sessionWallet && (!initialKeysFetched || !initialWebhooksFetched || !initialEventsFetched || !initialContractFetched || !initialLinksFetched || !initialPlansFetched));
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { signMessageAsync } = useSignMessage();


    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [isKeysLoading, setIsKeysLoading] = useState(false);
    const [revealSecret, setRevealSecret] = useState(false);
    const [isRolling, setIsRolling] = useState(false);
    const [apiKeyWebhookUrl, setApiKeyWebhookUrl] = useState("");
    const [apiKeySetupStatus, setApiKeySetupStatus] = useState<string | null>(null);


    const [webhookEndpoints, setWebhookEndpoints] = useState<any[]>([]);
    const [isWebhooksLoading, setIsWebhooksLoading] = useState(false);
    const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
    const [isEventsLoading, setIsEventsLoading] = useState(false);
    const [webhookUrlInput, setWebhookUrlInput] = useState("");
    const [isAddingWebhook, setIsAddingWebhook] = useState(false);
    const [revealWebhookSecret, setRevealWebhookSecret] = useState<string | null>(null);


    const [selectedWebhook, setSelectedWebhook] = useState<string>("");
    const [isReplaying, setIsReplaying] = useState(false);
    const [isTestingWebhook, setIsTestingWebhook] = useState<string | null>(null);
    const [replayStatus, setReplayStatus] = useState<string | null>(null);


    const [subName, setSubName] = useState("AI Agent Compute Limit");
    const [subCap, setSubCap] = useState("150.00");
    const [subInterval, setSubInterval] = useState("monthly");
    const [subChain, setSubChain] = useState("arc");

    const fetchPaymentLinks = async () => {
        setIsLinksLoading(true);
        try {
            const res = await fetch("/api/payment-links");
            const data = await res.json();
            if (data.links) {
                setPaymentLinks(data.links);
            }
        } catch (err) {
            console.error("Error fetching payment links:", err);
        } finally {
            setIsLinksLoading(false);
            setInitialLinksFetched(true);
        }
    };

    const fetchMerchantPlans = async () => {
        setIsPlansLoading(true);
        try {
            const [res, promoRes] = await Promise.all([
                fetch("/api/merchant/plans"),
                fetch("/api/merchant/promotions"),
            ]);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to load plans");
            }
            setMerchantPlans(data.plans || []);
            const promoData = await promoRes.json().catch(() => ({}));
            if (promoRes.ok && promoData.success) {
                setPlanPromotions(promoData.promotions || []);
            }
        } catch (err: any) {
            console.error("Error fetching merchant plans:", err);
            setPlanError(err.message || "Failed to load plans");
        } finally {
            setIsPlansLoading(false);
            setInitialPlansFetched(true);
        }
    };

    const handleCreatePlan = async (event: React.FormEvent) => {
        event.preventDefault();
        setPlanError(null);
        setPlanSuccess(null);

        if (!planName.trim()) {
            setPlanError("Plan name is required.");
            return;
        }
        if (!planAmountUsdc || Number(planAmountUsdc) <= 0) {
            setPlanError("Amount must be greater than 0 USDC.");
            return;
        }
        if (!planPeriodDays || Number(planPeriodDays) < 1) {
            setPlanError("Billing period must be at least 1 day.");
            return;
        }
        if (planDescription.length > PLAN_DESCRIPTION_MAX) {
            setPlanError(`Description must be ${PLAN_DESCRIPTION_MAX} characters or fewer.`);
            return;
        }
        const trimmedDetailsUrl = planDetailsUrl.trim();
        if (trimmedDetailsUrl && !/^https?:\/\//i.test(trimmedDetailsUrl)) {
            setPlanError("Details link must start with http:// or https://");
            return;
        }

        setIsPlansLoading(true);
        try {
            const res = await fetch("/api/merchant/plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: planName,
                    description: planDescription.trim() || undefined,
                    detailsUrl: trimmedDetailsUrl || undefined,
                    amountUsdc: planAmountUsdc,
                    periodDays: Number(planPeriodDays),
                    /* minCommitmentDays is deliberately absent. Nothing ever enforced it — the cancel
                       route never reads min_commitment_until, and no contract signature takes a
                       commitment argument — so from this form it was a promise to customers the
                       product could not keep. The column stays (NOT NULL DEFAULT 0) and API callers
                       can still set it via /api/v1/plans, which is where a merchant who genuinely
                       wants one can disclose it. Omitting the key is the path this form already took
                       whenever the field was left blank. */
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to create plan.");
            setPlanName("");
            setPlanDescription("");
            setPlanDetailsUrl("");
            setPlanAmountUsdc("");
            setPlanPeriodDays("30");
            setPlanSuccess("Plan created. Copy its subscribe link below and share it with customers.");
            setToastMessage("Plan Created");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
            await fetchMerchantPlans();
        } catch (err: any) {
            setPlanError(err.message || "Failed to create plan.");
        } finally {
            setIsPlansLoading(false);
        }
    };

    const handleTogglePlanActive = async (plan: MerchantPlan) => {
        setPlanError(null);
        setPlanSuccess(null);
        setIsPlansLoading(true);
        try {
            const res = await fetch("/api/merchant/plans", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: plan.id, active: !plan.active }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to update plan.");
            setPlanSuccess(!plan.active ? "Plan reactivated." : "Plan deactivated for new subscribers.");
            await fetchMerchantPlans();
        } catch (err: any) {
            setPlanError(err.message || "Failed to update plan.");
        } finally {
            setIsPlansLoading(false);
        }
    };

    const handleCreatePaymentLink = async (e: React.FormEvent) => {
        e.preventDefault();
        setLinkError(null);
        setLinkSuccess(null);
        setCreatedLinkInfo(null);
        setIsCreatingLink(true);

        try {
            if (!linkTitle.trim()) {
                throw new Error("Title is required");
            }
            if (!linkAmountUsdc || isNaN(Number(linkAmountUsdc)) || Number(linkAmountUsdc) <= 0) {
                throw new Error("Amount must be a positive number");
            }

            const rawAmount = parseUnits(limitDecimals(linkAmountUsdc, 6), 6).toString();
            const totalSelectedSeconds = linkDurationMinutes * 60;
            const expiresTimestamp = Math.floor(Date.now() / 1000) + totalSelectedSeconds;

            const res = await fetch("/api/payment-links", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: linkTitle,
                    description: linkDescription || null,
                    amount_usdc: rawAmount,
                    expires_at: linkDurationMinutes > 0 ? expiresTimestamp : null,
                    external_reference: linkExternalReference || null,
                    max_uses: linkMaxUses ? Number(linkMaxUses) : null,
                    invoice_number: linkInvoiceNumber.trim() || null,
                    due_date: linkDueDate || null,
                    payer_email: linkPayerEmail.trim() || null
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to create payment link");
            }

            setCreatedLinkInfo({
                id: data.link.id,
                title: data.link.title,
                checkoutUrl: data.link.checkoutUrl || buildCheckoutUrl(data.link.id, window.location.origin),
            });
            setLinkSuccess("Payment link created");
            setToastMessage("Link Created Successfully");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);
            setLinkTitle("");
            setLinkDescription("");
            setLinkAmountUsdc("");
            setLinkDurationMinutes(1440);
            setLinkMaxUses("1");
            setLinkInvoiceNumber("");
            setLinkDueDate("");
            setLinkPayerEmail("");
            setLinkExternalReference("");
            await fetchPaymentLinks();
        } catch (err: any) {
            setLinkError(err.message || "Something went wrong");
        } finally {
            setIsCreatingLink(false);
        }
    };

    const handleToggleLinkActive = async (linkId: string, currentActive: boolean) => {
        try {
            const res = await fetch(`/api/payment-links/${linkId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: !currentActive }),
            });
            if (res.ok) {
                await fetchPaymentLinks();
            } else {
                const data = await res.json();
                console.error("Failed to toggle payment link active state:", data.error);
            }
        } catch (err) {
            console.error("Error toggling payment link active state:", err);
        }
    };

    const handleUpdateLinkRules = async (linkId: string, durationMinutes: number, maxUses: string | null) => {
        try {
            const expiresAt = durationMinutes > 0
                ? Math.floor(Date.now() / 1000) + durationMinutes * 60
                : null;

            const res = await fetch(`/api/payment-links/${linkId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    expires_at: expiresAt,
                    max_uses: maxUses,
                }),
            });

            if (res.ok) {
                setToastMessage("Payment link rules updated");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
                await fetchPaymentLinks();
            } else {
                const data = await res.json();
                console.error("Failed to update payment link rules:", data.error);
                setLinkError(data.error || "Failed to update payment link rules");
            }
        } catch (err) {
            console.error("Error updating payment link rules:", err);
            setLinkError("Failed to update payment link rules");
        }
    };

    const handleDeleteLink = async (linkId: string) => {
        setConfirmModal({
            open: true,
            title: "Delete Payment Link",
            description: "This payment link will be permanently deleted. Any pending checkouts using this link will stop working. This cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    const res = await fetch(`/api/payment-links/${linkId}`, {
                        method: "DELETE",
                    });
                    if (res.ok) {
                        await fetchPaymentLinks();
                    } else {
                        const data = await res.json();
                        console.error("Failed to delete payment link:", data.error);
                    }
                } catch (err) {
                    console.error("Error deleting payment link:", err);
                }
            },
        });
    };

    const getPublicCheckoutUrl = (linkId: string, checkoutUrl?: string | null) => {
        return checkoutUrl || buildCheckoutUrl(linkId, typeof window !== "undefined" ? window.location.origin : undefined);
    };

    const handleCopyLink = (linkId: string, checkoutUrl?: string | null) => {
        const url = getPublicCheckoutUrl(linkId, checkoutUrl);
        navigator.clipboard.writeText(url);
        setLinkCopyFeedback(prev => ({ ...prev, [linkId]: true }));
        setTimeout(() => {
            setLinkCopyFeedback(prev => ({ ...prev, [linkId]: false }));
        }, 2000);
    };

    const fetchApiKeys = async () => {
        setIsKeysLoading(true);
        try {
            const res = await fetch("/api/keys");
            const data = await res.json();
            if (data.keys) {
                setApiKeys(data.keys);
            }
        } catch (err) {
            console.error("Error fetching keys:", err);
        } finally {
            setIsKeysLoading(false);
            setInitialKeysFetched(true);
        }
    };

    const fetchWebhookEndpoints = async () => {
        setIsWebhooksLoading(true);
        try {
            const res = await fetch("/api/webhooks/endpoints");
            const data = await res.json();
            if (data.endpoints) {
                setWebhookEndpoints(data.endpoints);
            }
        } catch (err) {
            console.error("Error fetching endpoints:", err);
        } finally {
            setIsWebhooksLoading(false);
            setInitialWebhooksFetched(true);
        }
    };

    const fetchWebhookEvents = async () => {
        setIsEventsLoading(true);
        try {
            const res = await fetch("/api/webhooks/events");
            const data = await res.json();
            if (data.events) {
                setWebhookEvents(data.events);
                if (data.events.length > 0 && !selectedWebhook) {
                    setSelectedWebhook(data.events[0].id);
                }
            }
        } catch (err) {
            console.error("Error fetching events:", err);
        } finally {
            setIsEventsLoading(false);
            setInitialEventsFetched(true);
        }
    };


    useEffect(() => {
        const restoreSession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn && data.wallet) {
                    if (!data.role) {
                        console.warn("Missing account role");
                        setSessionAlert("role_missing");
                        return;
                    }
                    if (data.role === "USER") {
                        console.warn("Unauthorized role for merchant dashboard");
                        setSessionAlert("wrong_role");
                        return;
                    }
                    setSessionWallet(data.wallet.toLowerCase());
                    setIsAdmin(Boolean(data.isAdmin));
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
    }, [router]);


    useEffect(() => {
        if (!address) {
            setSessionWallet(null);
            setApiKeys([]);
            setWebhookEndpoints([]);
            setWebhookEvents([]);
            setInitialKeysFetched(false);
            setInitialWebhooksFetched(false);
            setInitialEventsFetched(false);
            setInitialContractFetched(false);
            setInitialPlansFetched(false);
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
                    } else if (data.wallet.toLowerCase() !== address.toLowerCase()) {
                        console.warn("Session wallet mismatch");
                        setSessionAlert("wallet_mismatch");
                        return;
                    }
                    if (!data.role) {
                        console.warn("Missing account role");
                        setSessionAlert("role_missing");
                        return;
                    }
                    if (data.role === "USER") {
                        console.warn("Unauthorized role for merchant dashboard");
                        setSessionAlert("wrong_role");
                        return;
                    }
                    setSessionWallet(data.wallet.toLowerCase());
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
    }, [address, isConnected, embeddedWallet, router]);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpEmail || !otpEmail.includes("@")) {
            setOtpError("Please enter a valid email address.");
            return;
        }
        setOtpLoading(true);
        setOtpError(null);
        try {
            const res = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: otpEmail }),
            });
            const data = await res.json();
            if (data.success) {
                setOtpSent(true);
                console.log("Development OTP Code:", data.devOtpCode);
            } else {
                setOtpError(data.error || "Failed to send verification code.");
            }
        } catch (err) {
            console.error("Error sending OTP:", err);
            setOtpError("Network error sending OTP code.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode) {
            setOtpError("Please enter the verification code.");
            return;
        }
        setOtpLoading(true);
        setOtpError(null);
        try {
            const res = await fetch("/api/auth/otp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: otpEmail, code: otpCode, rememberMe }),
            });
            const data = await res.json();
            if (data.success) {
                setEmbeddedWallet({
                    wallet: data.wallet,
                    email: data.email
                });
                setSessionWallet(data.wallet.toLowerCase());
                setOtpSuccess(true);
            } else {
                setOtpError(data.error || "Invalid verification code.");
            }
        } catch (err) {
            console.error("Error verifying OTP:", err);
            setOtpError("Network error verifying OTP code.");
        } finally {
            setOtpLoading(false);
        }
    };

    const fetchAlias = useCallback(async () => {
        try {
            const res = await fetch("/api/merchant/alias");
            if (res.ok) {
                const data = await res.json();
                setMerchantAlias(data.alias);
                setMerchantAliasIsAnonymous(!!data.is_anonymous);
                setAliasInput(data.alias || "");
                setAliasIsAnonymousInput(!!data.is_anonymous);
                setMerchantAliasNextChange(data.next_change_at || null);
            }
        } catch (err) {
            console.error("Error fetching merchant alias:", err);
        }
    }, []);

    const handleSaveAlias = async () => {
        setIsSavingAlias(true);
        setAliasSuccessMessage(null);
        setAliasErrorMessage(null);
        try {
            let finalAlias = aliasInput.trim().toLowerCase();
            if (finalAlias && !finalAlias.endsWith(".sub")) {
                finalAlias = finalAlias + ".sub";
            }
            const res = await fetch("/api/merchant/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    alias: finalAlias,
                    isAnonymous: aliasIsAnonymousInput
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to save alias");
            }
            setMerchantAlias(data.alias);
            setMerchantAliasIsAnonymous(data.is_anonymous);
            setAliasInput(data.alias || "");
            setAliasSuccessMessage("Alias updated");
            fetchPaymentLinks();
        } catch (err: any) {
            setAliasErrorMessage(err.message || "An error occurred");
        } finally {
            setIsSavingAlias(false);
        }
    };

    const handleDeleteAlias = async () => {
        setIsSavingAlias(true);
        setAliasSuccessMessage(null);
        setAliasErrorMessage(null);
        try {
            const res = await fetch("/api/merchant/alias", {
                method: "DELETE"
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to remove alias");
            }
            setMerchantAlias(null);
            setMerchantAliasIsAnonymous(false);
            setAliasInput("");
            setAliasIsAnonymousInput(false);
            setAliasSuccessMessage("Alias removed");
            fetchPaymentLinks();
        } catch (err: any) {
            setAliasErrorMessage(err.message || "An error occurred");
        } finally {
            setIsSavingAlias(false);
        }
    };

    const loadBackendData = useCallback(async () => {
        if (!sessionWallet) return;
        
        await Promise.all([
            fetchApiKeys(),
            fetchWebhookEndpoints(),
            fetchWebhookEvents(),
            fetchPaymentLinks(),
            fetchMerchantPlans(),
            fetchAlias(),
        ]);
    }, [sessionWallet, fetchAlias]);

    useEffect(() => {
        if (sessionWallet) {
            loadBackendData();
        }
    }, [sessionWallet, loadBackendData]);

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

    const handleDnsClick = () => {
        setActiveTab("settings");
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            setSessionWallet(null);
            setEmbeddedWallet(null);
            setApiKeys([]);
            setWebhookEndpoints([]);
            setWebhookEvents([]);
            setInitialKeysFetched(false);
            setInitialWebhooksFetched(false);
            setInitialEventsFetched(false);
            setInitialContractFetched(false);
        } catch (err) {
            console.error("Error logging out:", err);
        }
    };

    const handleAddWebhook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!webhookUrlInput) return;
        setIsAddingWebhook(true);
        try {
            const res = await fetch("/api/webhooks/endpoints", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrlInput }),
            });
            const data = await res.json();
            if (data.endpoint) {
                setWebhookEndpoints(prev => [data.endpoint, ...prev]);
                setWebhookUrlInput("");
            } else {
                setToastMessage(data.error || "Failed to add endpoint");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 4000);
            }
        } catch (err) {
            console.error("Error adding endpoint:", err);
        } finally {
            setIsAddingWebhook(false);
        }
    };

    const handleDeleteWebhook = async (id: string) => {
        setConfirmModal({
            open: true,
            title: "Delete Webhook Endpoint",
            description: "This endpoint will stop receiving webhook events immediately. This cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    const res = await fetch(`/api/webhooks/endpoints?id=${id}`, {
                        method: "DELETE",
                    });
                    const data = await res.json();
                    if (data.success) {
                        setWebhookEndpoints(prev => prev.filter(e => e.id !== id));
                    }
                } catch (err) {
                    console.error("Error deleting endpoint:", err);
                }
            },
        });
    };


    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);


    const [ledgers, setLedgers] = useState<any[]>([]);
    const [ledgerPagination, setLedgerPagination] = useState({ total: 0, totalPages: 1 });
    const [merchantAnalytics, setMerchantAnalytics] = useState<MerchantAnalyticsSummary | null>(null);
    const [isLoadingContract, setIsLoadingContract] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const ledgerCursor = ledgerCursors[ledgerPage] || null;


    useEffect(() => {
        const merchantAddress = address;
        if (!isConnected || !merchantAddress) {
            setLedgers([]);
            setLedgerPagination({ total: 0, totalPages: 1 });
            setMerchantAnalytics(null);
            setLedgerPage(0);
            setLedgerCursors([null]);
            return;
        }

        let isSubscribed = true;

        async function fetchOnChainData() {
            if (!merchantAddress) return;
            setIsLoadingContract(true);
            try {
                const cursorParam = ledgerCursor ? `&cursor=${encodeURIComponent(ledgerCursor)}` : "";
                const mirrorResponse = await fetch(`/api/merchant/subscriptions?pageSize=5${cursorParam}`);
                const mirrorPayload = await mirrorResponse.json().catch(() => null);
                if (!mirrorResponse.ok || !mirrorPayload?.success) {
                    throw new Error(mirrorPayload?.error || "Subscription analytics could not be loaded");
                }

                /* The server owns merchant scoping, complete aggregates, and page-bounded detail.
                   This keeps browser work constant and removes every protocol-wide RPC scan. */
                const fetchedLedgers = (mirrorPayload.subscriptions || []).map((subscription: MerchantSubscriptionDetail) => {
                    /* The API no longer sends who the subscriber is, so a row is identified by the
                       merchant's own reference when they set one and otherwise by an opaque
                       subscription number. That is enough to match a row against a webhook or an
                       API call without naming the customer. */
                    const reference = subscription.externalReference || `Subscription #${subscription.subscriptionId}`;
                    const nextBillingTs = subscription.nextBillingDate
                        ? Math.floor(new Date(subscription.nextBillingDate).getTime() / 1000)
                        : 0;
                    return {
                        id: `agent-run-${subscription.subscriptionId}`,
                        rawId: subscription.subscriptionId,
                        displayAddress: reference,
                        shortSubAddress: reference,
                        limit: `${formatUnits(BigInt(subscription.amountUsdcMicros), 6)} USDC / ${formatPlanPeriod(subscription.periodSeconds)}`,
                        rawAmount: formatUnits(BigInt(subscription.amountUsdcMicros), 6),
                        rawPeriod: subscription.periodSeconds,
                        nextBilling: subscription.nextBillingDate
                            ? new Date(subscription.nextBillingDate).toLocaleDateString()
                            : "Not scheduled",
                        nextPaymentTs: nextBillingTs,
                        activityAt: subscription.activityAt,
                        active: subscription.status === "ACTIVE",
                        billingStatus: subscription.status,
                        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                        downgradeFailures: Number(subscription.downgradeFailures || 0),
                    };
                });
                
                if (isSubscribed) {
                    const totalPages = Math.max(1, Number(mirrorPayload.pagination?.totalPages || 1));
                    if (ledgerPage >= totalPages) {
                        setLedgerPage(totalPages - 1);
                        return;
                    }
                    setLedgers(fetchedLedgers);
                    setLedgerPagination({
                        total: Number(mirrorPayload.pagination?.total || 0),
                        totalPages,
                    });
                    const nextCursor = mirrorPayload.pagination?.nextCursor || null;
                    setLedgerCursors((current) => {
                        const updated = current.slice(0, ledgerPage + 1);
                        if (nextCursor) updated[ledgerPage + 1] = String(nextCursor);
                        return updated;
                    });
                    setMerchantAnalytics(mirrorPayload.analytics || null);
                    if (fetchedLedgers.length > 0) {
                        setSelectedWebhook((current) => current || "evt_01_0");
                    }
                }
            } catch (err) {
                console.error("Error fetching on-chain subscriptions:", err);
            } finally {
                if (isSubscribed) {
                    setIsLoadingContract(false);
                    setInitialContractFetched(true);
                }
            }
        }

        fetchOnChainData();
        /* 45s: subscription state changes on billing-cycle timescales; a 10s poll only
           multiplied RPC load (and 429s) without making the numbers fresher in practice. */
        const interval = setInterval(fetchOnChainData, 45000);

        return () => {
            isSubscribed = false;
            clearInterval(interval);
        };
    }, [isConnected, address, isPremium, refreshTrigger, ledgerPage, ledgerCursor]);

    const handleCopy = (text: string, label: string) => {
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(err => {
                    console.warn("Clipboard write failed:", err);
                });
            }
        } catch (err) {
            console.warn("Synchronous clipboard write failed:", err);
        }
        setCopiedText(label);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleRollKeys = async () => {
        const hasActiveKey = apiKeys.some((key) => !key.revoked);
        setConfirmModal({
            open: true,
            title: hasActiveKey ? "Rotate API Key" : "Generate API Key",
            description: hasActiveKey
                ? "The current production key will stop working immediately. Existing integrations will fail until they are updated with the new key."
                : "Your secret key will be shown once. Save it before leaving this page.",
            confirmLabel: hasActiveKey ? "Rotate Key" : "Generate Key",
            variant: hasActiveKey ? "danger" : "default",
            onConfirm: async () => {
                setConfirmModal(null);
                setIsRolling(true);
                setApiKeySetupStatus(null);
                try {
                    const webhookUrl = apiKeyWebhookUrl.trim();
                    const res = await fetch("/api/keys", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(webhookUrl ? { webhookUrl } : {}),
                    });
                    const data = await res.json();
                    if (data.key) {
                        setApiKeys([data.key]);
                        handleCopy(data.key.secretKeyPlain, "API Secret Key Rolled");
                        if (data.webhookEndpoint) {
                            setWebhookEndpoints((current) => [
                                data.webhookEndpoint,
                                ...current.filter((endpoint) => endpoint.id !== data.webhookEndpoint.id),
                            ]);
                            setApiKeyWebhookUrl("");
                        }
                        if (data.webhookWarning) {
                            setApiKeySetupStatus(`API key created, but webhook setup needs attention: ${data.webhookWarning}`);
                        } else {
                            setApiKeySetupStatus(data.webhookEndpoint
                                ? "API key and webhook endpoint created."
                                : "API key created. Register a webhook before going live.");
                        }
                    } else {
                        setApiKeySetupStatus(data.error || "Could not create API credentials.");
                    }
                } catch (err) {
                    console.error("Error rolling keys:", err);
                    setApiKeySetupStatus("Network error while creating API credentials.");
                } finally {
                    setIsRolling(false);
                }
            },
        });
    };

    const handleRetryCharge = async (rawId: string) => {
        try {
            const userAddress = address as `0x${string}`;
            
            // Query the next unexecuted sequence ID
            let sequenceId = 1;
            while (true) {
                const isExecuted = await publicClient.readContract({
                    address: STANDARD_CONTRACT_ADDRESS,
                    abi: STANDARD_ABI,
                    functionName: "isSequenceExecuted",
                    args: [BigInt(rawId), BigInt(sequenceId)],
                });
                if (!isExecuted) {
                    break;
                }
                sequenceId++;
            }

            await publicClient.simulateContract({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                account: userAddress,
                args: [BigInt(rawId), BigInt(sequenceId)],
            });

            const txHash = await executeContractWrite({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                args: [BigInt(rawId), BigInt(sequenceId)],
            });

            const receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash as `0x${string}`,
                timeout: 120_000,
            });

            if (receipt.status !== "success") {
                throw new Error("Payment execution transaction reverted on-chain.");
            }

            await refetchBalancesAndTier();
            setRefreshTrigger((prev) => prev + 1);
        } catch (err: any) {
            console.error("Error retrying subscription charge:", err);
            setToastMessage(err.message || "Failed to execute subscription payment.");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);
            throw err;
        }
    };

    const handleReplayWebhook = async (eventId?: string) => {
        setIsReplaying(true);
        setReplayStatus(eventId ? "Replaying event..." : "Resending latest event...");
        try {
            const res = await fetch("/api/webhooks/events/replay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(eventId ? { eventId } : { latest: true }),
            });
            const data = await res.json();
            if (data.success) {
                setReplayStatus(`Webhook event successfully re-delivered. HTTP ${data.status} OK.`);
                await fetchWebhookEvents();
            } else {
                setReplayStatus(`Webhook re-delivery failed. HTTP ${data.status}.`);
            }
            setTimeout(() => setReplayStatus(null), 4000);
        } catch (err) {
            console.error("Error replaying webhook:", err);
            setReplayStatus("Network error replaying webhook.");
            setTimeout(() => setReplayStatus(null), 4000);
        } finally {
            setIsReplaying(false);
        }
    };

    const handleSendWebhookTest = async (eventType: "test" | "payment.succeeded" | "subscription.created") => {
        setIsTestingWebhook(eventType);
        setReplayStatus(`Sending ${eventType} test event...`);
        try {
            const res = await fetch("/api/webhooks/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventType }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || data.message || "Test webhook delivery failed.");
            }
            setReplayStatus(data.message || `${eventType} test event sent.`);
            await Promise.all([fetchWebhookEndpoints(), fetchWebhookEvents()]);
        } catch (err: any) {
            setReplayStatus(err.message || "Network error sending test webhook.");
        } finally {
            setIsTestingWebhook(null);
            setTimeout(() => setReplayStatus(null), 6000);
        }
    };


    const handleWithdraw = async (targetAddress?: string) => {
        if (vaultBalance <= 0) return;
        setIsWithdrawing(true);
        try {
            const liveBalanceRaw = await publicClient.readContract({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "merchantBalances",
                args: [address as `0x${string}`],
            });
            const liveBalance = Number(formatUnits(liveBalanceRaw, 6));
            if (Math.abs(liveBalance - vaultBalance) > 0.000001) {
                setVaultBalance(liveBalance);
                throw new Error(`Claimable balance changed to ${liveBalance.toFixed(2)} USDC. Review the updated amount before confirming again.`);
            }
            const hasTarget = targetAddress && targetAddress.toLowerCase() !== address?.toLowerCase();
            const txHash = await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: hasTarget ? "withdrawTo" : "withdraw",
                args: hasTarget ? [targetAddress as `0x${string}`] : [],
            });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
            if (receipt.status !== "success") throw new Error("The withdrawal failed before on-chain confirmation.");

            setWithdrawSuccess(true);
            setToastMessage("Withdrawal confirmed on Arc");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);
            setTimeout(() => setWithdrawSuccess(false), 4000);
            refetchVaultBalance();
            refetchWalletBalance();
        } catch (err: any) {
            console.error("Withdraw failed:", err);
            throw err;
        } finally {
            setIsWithdrawing(false);
        }
    };



    /* The premium checkout itself lives on /merchant/upgrade (src/app/dashboard/upgrade/page.tsx),
       which handles both embedded (custody) and browser wallets and never re-runs a checkout after
       a payment transaction was submitted. The dashboard only links there. */

    const handleCancelPremium = async () => {
        if (!isConnected || !activeMerchantAddress || !isPremium) {
            setPremiumError("No active subscription metadata to cancel.");
            return;
        }

        if (isCancellingPremium) {
            return;
        }

        setConfirmModal({
            open: true,
            title: "Cancel Premium Pro",
            description: "Your Premium Pro benefits will remain active until the end of the current billing period. You can resume before that date.",
            confirmLabel: "Cancel Plan",
            variant: "warning",
            onConfirm: async () => {
                setConfirmModal(null);
                setIsCancellingPremium(true);
                setPremiumStatus("Executing cancellation...");
                setPremiumError(null);

                try {
                    /* Send the POST request to /api/premium/cancel */
                    const cancelRes = await fetch("/api/premium/cancel", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" }
                    });
                    const cancelData = await cancelRes.json();
                    if (!cancelRes.ok) {
                        throw new Error(cancelData.error || "Failed to sync cancellation to database.");
                    }

                    const dateStr = cancelData.nextBillingDate ? new Date(cancelData.nextBillingDate).toLocaleDateString() : "the end of the current period";
                    setPremiumStatus(`Premium Pro subscription has been cancelled. Active until ${dateStr}.`);
                    setIsPremium(false);
                    setCancelAtPeriodEnd(true);
                    setMerchantTier(0);
                    await refetchBalancesAndTier();
                    setTimeout(() => setPremiumStatus(null), 8000);
                } catch (err: any) {
                    console.error("Cancellation failed:", err);
                    setPremiumError(err.message || "Cancellation failed.");
                } finally {
                    setIsCancellingPremium(false);
                }
            },
        });
    };

    const handleResumePremium = async () => {
        if (!isConnected || !activeMerchantAddress || !isPremium || !cancelAtPeriodEnd) {
            setPremiumError("No cancellation schedule to resume.");
            return;
        }

        if (isResumingPremium) {
            return;
        }

        setIsResumingPremium(true);
        setPremiumStatus("Restoring premium subscription...");
        setPremiumError(null);

        try {
            const resumeRes = await fetch("/api/premium/resume", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const resumeData = await resumeRes.json();
            if (!resumeRes.ok) {
                throw new Error(resumeData.error || "Failed to resume subscription.");
            }

            setPremiumStatus("Premium Pro renewal has been restored. Your subscription will continue normally.");
            await refetchBalancesAndTier();
            setTimeout(() => setPremiumStatus(null), 6000);
        } catch (err: any) {
            console.error("Resume failed:", err);
            setPremiumError(err.message || "Resume failed.");
        } finally {
            setIsResumingPremium(false);
        }
    };


    const handleReroute = async () => {
        if (!rerouteAddress || !rerouteAddress.startsWith("0x") || rerouteAddress.length !== 42) {
            setPremiumError("Please enter a valid Ethereum address (0x...).");
            return;
        }
        setIsRerouting(true);
        setPremiumError(null);
        try {
            await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "configurePayoutDestination",
                args: [rerouteAddress as `0x${string}`],
            });
            setRerouteSuccess(true);
            setTimeout(() => setRerouteSuccess(false), 4000);
            refetchPayoutDest();
        } catch (err: any) {
            console.error("Reroute failed:", err);
            setPremiumError(err.shortMessage || err.message || "Reroute transaction failed");
        } finally {
            setIsRerouting(false);
        }
    };

    const handleToggleShielded = () => {
        setShieldedEnabled(prev => !prev);
    };

    const handleGenerateViewKey = () => {
        try {
            const keyBytes = ethers.randomBytes(32);
            const keyHex = ethers.hexlify(keyBytes);
            setViewKey(keyHex);
            setIsViewKeyRegistered(false);
            setShowViewKey(true);
        } catch (err) {
            console.error("Failed to generate view key:", err);
        }
    };

    const handleCopyViewKey = () => {
        if (!viewKey) return;
        navigator.clipboard.writeText(viewKey);
        setCopiedViewKey(true);
        setTimeout(() => setCopiedViewKey(false), 2000);
    };

    const handleSaveConfidentiality = async () => {
        if (!viewKey || !address) return;
        setIsSavingConfidentiality(true);
        setPremiumError(null);
        try {
            const viewKeyHash = ethers.keccak256(viewKey);

            /* 1. If key is not registered, use commit-reveal to prevent front-running */
            if (!isViewKeyRegistered) {
                /* Generate a random salt to blind the commitment */
                const salt = ethers.hexlify(ethers.randomBytes(32));

                /* commitment = keccak256(abi.encodePacked(viewKeyHash, msg.sender, salt)) */
                const commitment = ethers.keccak256(
                    ethers.solidityPacked(
                        ["bytes32", "address", "bytes32"],
                        [viewKeyHash, address, salt]
                    )
                );

                /* Phase 1: commit the blinded hash */
                await executeContractWrite({
                    address: CONFIDENTIAL_CONTRACT_ADDRESS,
                    abi: CONFIDENTIAL_CONTRACT_ABI,
                    functionName: "commitViewKey",
                    args: [commitment],
                });

                /* Wait for COMMIT_DELAY blocks (~20s on Arc with ~2s blocks).
                   Poll the chain until enough blocks have passed. */
                const provider = new ethers.BrowserProvider((window as any).ethereum);
                const commitBlockNum = await provider.getBlockNumber();
                const targetBlock = commitBlockNum + 11; /* COMMIT_DELAY (10) + 1 margin */

                await new Promise<void>((resolve, reject) => {
                    const maxWait = setTimeout(() => reject(new Error("Timed out waiting for commit delay")), 120_000);
                    const poll = setInterval(async () => {
                        try {
                            const current = await provider.getBlockNumber();
                            if (current >= targetBlock) {
                                clearInterval(poll);
                                clearTimeout(maxWait);
                                resolve();
                            }
                        } catch {
                            /* keep polling */
                        }
                    }, 2000);
                });

                /* Phase 2: reveal the view key hash */
                await executeContractWrite({
                    address: CONFIDENTIAL_CONTRACT_ADDRESS,
                    abi: CONFIDENTIAL_CONTRACT_ABI,
                    functionName: "revealViewKey",
                    args: [viewKeyHash, salt],
                });
            }

            /* 2. Update backend database setting */
            const res = await fetch("/api/merchant/confidentiality", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shieldedPayoutsEnabled: shieldedEnabled,
                    viewKeyHash: viewKeyHash
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to save confidentiality settings on server");
            }

            setIsViewKeyRegistered(true);
            /* Store in sessionStorage (not localStorage) — cleared on tab close to
               reduce the XSS exposure window for the plaintext view key. */
            if (typeof window !== "undefined" && address) {
                sessionStorage.setItem(`subscript_viewkey_${address.toLowerCase()}`, viewKey);
            }
            
            /* Refresh settings */
            await refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Save confidentiality error:", err);
            setPremiumError(err.message || "Failed to register View Key");
        } finally {
            setIsSavingConfidentiality(false);
        }
    };


    const handleTriggerKeeper = async () => {
        setIsTriggeringKeeper(true);
        setKeeperStatus(null);
        setKeeperError(null);
        try {
            const response = await fetch("/api/keeper/trigger", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to trigger keepers");
            }
            if (data.executedCount > 0) {
                setKeeperStatus(`Checked successfully. Executed ${data.executedCount} recurring subscription payment(s) on-chain!`);
            } else {
                setKeeperStatus("Checked successfully. No recurring subscriptions are currently due for renewal.");
            }
            setTimeout(() => setKeeperStatus(null), 5000);
            refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Manual keeper trigger failed:", err);
            setKeeperError(err.message || "Execution failed");
            setTimeout(() => setKeeperError(null), 5000);
        } finally {
            setIsTriggeringKeeper(false);
        }
    };

    const merchantWalletAddress = activeMerchantAddress || "";
    const checkoutCode = useMemo(() => `import { SubScriptCheckoutButton } from "@/components/subscript/SubScriptCheckoutButton";

<SubScriptCheckoutButton
  amountUsdc="${subCap}"
  planName="${subName}"
  description="${subInterval} access"
  externalReference="user_or_order_id"
/>`, [subCap, subInterval, subName]);

    const agentIntegrationPrompt = useMemo(() => {
        return `I want to integrate the SubScript Protocol into this codebase.
Please inspect the workspace. If the initialization package has NOT been run yet, please run it in the terminal first:
npx @subscriptonarc/create

This initialization tool installs the SubScript SDK, prompts for deployment parameters, writes SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET into .env.local, configures .cursorrules, and scaffolds both a server-side checkout intent route and a signed webhook route.

Once initialized, read .env.local and the .cursorrules file to find the plan parameters (merchant wallet address, plan name, plan cap, interval) and target framework.

Here are my project configuration specifications for this integration:
- Wallet Connection Provider: ${walletProvider === "none" ? "None / Implement standard wallet connection (e.g. RainbowKit or Privy)" : walletProvider}
- Backend & Database Provider: ${dbProvider === "none" ? "None / Detect database from project structure or recommend Prisma" : dbProvider}
- Session Persistence Mechanism: ${sessionProvider === "none" ? "None / Detect session pattern or recommend HTTP secure cookies or JWT" : sessionProvider}

Please complete the following implementation tasks:
1. Checkout Intent Creation: Locate the generated server route (for example, src/app/api/subscript/checkout/route.ts). From the pricing page, call that route with amountUsdc, title, description, externalReference, and an idempotencyKey. Store the returned intentId beside the logged-in user/order/subscription before redirecting the user to checkoutUrl.
2. Webhook Fulfillment: Locate the generated webhook route (for example, src/app/api/webhooks/subscript/route.ts or an Express router). Keep raw-body x-subscript-signature verification enabled. When event.type === "payment.succeeded" (its alias "payment.success" is also accepted), use data.intent_id or data.checkout_session_id to find the local record, enforce idempotency with event.id, and unlock the matching plan exactly once using ${dbProvider === "none" ? "the detected database" : dbProvider}.
3. User Session: Set up session recreation/persistence using ${sessionProvider === "none" ? "HTTP-only secure cookies or JWT" : sessionProvider} so the frontend can determine whether the logged-in user has an active paid subscription. Do not ask my app to know the payer wallet; SubScript maps wallet payment activity to the Checkout Intent.
4. Payment Rail Boundary: Treat hosted checkout as Arc-native USDC only. Do not add Base, Solana, or CCTP checkout claims unless the SubScript docs in this repo explicitly say hosted CCTP memo settlement is live.
5. Clean Code Practices: Keep SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET server-side only. Do not add emojis in comments or logs.`;
    }, [walletProvider, dbProvider, sessionProvider]);

    const cursorMcpConfig = useMemo(() => JSON.stringify({
        mcpServers: {
            subscript: {
                command: "npx",
                args: ["-y", "@subscriptonarc/mcp"],
                env: {
                    SUBSCRIPT_MERCHANT_ADDRESS: merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS",
                    SUBSCRIPT_CHAIN_ID: String(activeArcChain.id),
                    SUBSCRIPT_ROUTER_ADDRESS,
                    SUBSCRIPT_USDC_NATIVE_GAS_ADDRESS: USDC_NATIVE_GAS_ADDRESS,
                },
            },
        },
    }, null, 2), [merchantWalletAddress]);

    const handleConnect = () => {
        const connector = connectors.find((c) => c.id === "injected") || connectors[0];
        if (connector) {
            connect({ connector });
        } else {
            connect({ connector: injected() });
        }
    };


    const activeAllowances = merchantAnalytics?.activeSubscriptions ?? ledgers.filter(l => l.active).length;
    const totalSubs = merchantAnalytics?.totalSubscriptions ?? ledgerPagination.total;
    const revokedCount = Math.max(0, totalSubs - activeAllowances);
    const failureRate = totalSubs > 0 ? ((revokedCount / totalSubs) * 100).toFixed(1) : "0.0";
    /* Only subscriptions that will actually renew belong in a forward projection: an
       on-chain-active sub that is mid-failed-renewal, past due, or ending at period end
       will not collect next cycle, so counting it overstates expected volume. Mirrors
       the isPaying definition in AnalyticsDashboard. */
    const projected30DaySettlement = merchantAnalytics?.mrrUsdc ?? ledgers.reduce((acc, sub) => {
        const willRenew = sub.active
            && sub.billingStatus === "ACTIVE"
        if (!willRenew) return acc;
        const amountNum = parseFloat(sub.rawAmount) || 0;
        const periodNum = parseFloat(sub.rawPeriod) || 2592000;
        const monthlyEquivalent = amountNum * (2592000 / periodNum);
        return acc + monthlyEquivalent;
    }, 0);

    const primaryColorText = "text-[#082824]";
    const primaryColorBg = "bg-[#8AB4DB]";

    const renderPremiumLock = (tabLabel: string) => {
        return (
            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-10 flex flex-col items-center justify-center text-center gap-6 min-h-[400px] text-black dark:text-white">
                <div className="p-5 rounded-full bg-amber-500/10 dark:bg-amber-400/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 dark:border-amber-400/30">
                    <Crown className="w-10 h-10" />
                </div>
                <div className="space-y-3 max-w-md">
                    <h2 className="text-xl font-semibold text-black dark:text-white">Premium Pro Feature Locked</h2>
                    <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                        Access to <span className="font-semibold text-black dark:text-white">{tabLabel}</span> requires an active SubScript Premium subscription. Upgrade to unlock keys, private checkout generation, and webhook event streaming.
                    </p>
                </div>
                <button
                    onClick={() => setActiveTab("premium")}
                    className="px-8 py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] rounded-full text-xs font-semibold flex items-center gap-2 transition-all"
                >
                    <Crown className="w-4 h-4" />
                    Upgrade to Premium Pro
                </button>
            </div>
        );
    };

    const renderPaymentLinksTab = () => {
        if (isConnected && address && !sessionWallet && !embeddedWallet) {
            return (
                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 text-black font-sans">
                    <Shield className="w-10 h-10 mx-auto text-[#082824]" />
                    <h2 className="text-lg font-semibold text-black">Verify Wallet Ownership</h2>
                    <p className="text-xs text-black/60 leading-relaxed max-w-xs mx-auto">
                        To protect your payment configurations and links, please sign a secure message using your connected wallet.
                    </p>
                    <button
                        onClick={handleBackendLogin}
                        disabled={isLoggingIn}
                        className="w-full py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                        {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-[#082824]" /> : <Shield className="w-4 h-4" />}
                        Authenticate Developer Portal
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-8">
                {/* Create Payment Link Form */}
                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                    <div>
                        <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2 flex items-center gap-2.5">
                            <Link2 className="w-5 h-5 text-[#082824]" />
                            Create Hosted Payment Link
                        </h2>
                        <p className="text-sm sm:text-base text-black/70 font-sans leading-relaxed">
                            Generate direct checkout links for individual purchases. Customers will pay USDC on the Arc Network.
                        </p>
                    </div>

                    <form onSubmit={handleCreatePaymentLink} className="space-y-5 font-sans text-sm sm:text-base">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Product Title *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Pro Membership Key"
                                    value={linkTitle}
                                    onChange={(e) => setLinkTitle(e.target.value)}
                                    required
                                    className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">USDC Amount *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="e.g. 15.00"
                                    value={linkAmountUsdc}
                                    onChange={(e) => setLinkAmountUsdc(e.target.value)}
                                    required
                                    className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Description</label>
                            <textarea
                                placeholder="Describe what the customer gets with this payment link..."
                                value={linkDescription}
                                onChange={(e) => setLinkDescription(e.target.value)}
                                rows={3}
                                className="w-full resize-none rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => setShowLinkAdvanced(!showLinkAdvanced)}
                                className="text-xs sm:text-sm text-black/70 hover:text-black flex items-center gap-1.5 font-bold transition-colors"
                            >
                                <Sliders className="w-4 h-4" />
                                {showLinkAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
                            </button>
                        </div>

                        {showLinkAdvanced && (
                            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-black/10">
                                <div className="col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(1440);
                                            setLinkMaxUses("1");
                                        }}
                                        className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-all ${
                                            linkDurationMinutes === 1440 && linkMaxUses === "1"
                                                ? "border-[#082824] bg-[#082824] text-white shadow-sm dark:border-white/30 dark:bg-white dark:text-[#082824]"
                                                : "border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black dark:border-white/10 dark:bg-white/10 dark:text-white/75 dark:hover:bg-white/15 dark:hover:text-white"
                                        }`}
                                    >
                                        One-Time 24H
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(7 * 24 * 60);
                                            setLinkMaxUses("");
                                        }}
                                        className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-all ${
                                            linkDurationMinutes === 7 * 24 * 60 && linkMaxUses !== "1"
                                                ? "border-[#082824] bg-[#082824] text-white shadow-sm dark:border-white/30 dark:bg-white dark:text-[#082824]"
                                                : "border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black dark:border-white/10 dark:bg-white/10 dark:text-white/75 dark:hover:bg-white/15 dark:hover:text-white"
                                        }`}
                                    >
                                        Reusable 7D
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(0);
                                            setLinkMaxUses("");
                                        }}
                                        className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-all ${
                                            linkDurationMinutes === 0
                                                ? "border-[#082824] bg-[#082824] text-white shadow-sm dark:border-white/30 dark:bg-white dark:text-[#082824]"
                                                : "border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black dark:border-white/10 dark:bg-white/10 dark:text-white/75 dark:hover:bg-white/15 dark:hover:text-white"
                                        }`}
                                    >
                                        No Expiry
                                    </button>
                                </div>
                                <div className="space-y-1.5 col-span-2">
                                    <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Expiration Window</label>
                                    <DurationPicker
                                        value={linkDurationMinutes}
                                        onChange={(mins) => setLinkDurationMinutes(mins)}
                                    />
                                    <p className="text-xs text-black/50">Set duration to 00:00 for a link that does not expire automatically.</p>
                                </div>

                                <div className="space-y-1.5 col-span-2">
                                    <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">External Reference (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. internal-sku-102"
                                        value={linkExternalReference}
                                        onChange={(e) => setLinkExternalReference(e.target.value)}
                                        className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                    />
                                </div>

                                <div className="col-span-2 space-y-3 rounded-2xl border border-black/10 bg-black/[0.02] p-5">
                                    <p className="text-xs sm:text-sm font-bold text-[#082824]">
                                        Invoice details <span className="font-normal text-black/50">(optional, turns this link into an invoice; shown on the checkout page)</span>
                                    </p>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Invoice Number</label>
                                            <input
                                                type="text"
                                                placeholder="INV-2026-001"
                                                value={linkInvoiceNumber}
                                                onChange={(e) => setLinkInvoiceNumber(e.target.value.slice(0, 64))}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-black text-sm transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Due Date</label>
                                            <input
                                                type="date"
                                                value={linkDueDate}
                                                onChange={(e) => setLinkDueDate(e.target.value)}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-black text-sm transition-colors focus:border-[#8AB4DB] focus:outline-none [color-scheme:light]"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Payer Email</label>
                                            <input
                                                type="email"
                                                placeholder="billing@client.com"
                                                value={linkPayerEmail}
                                                onChange={(e) => setLinkPayerEmail(e.target.value)}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-black text-sm transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1.5 col-span-2">
                                    <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Maximum Uses</label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="Unlimited"
                                        value={linkMaxUses}
                                        onChange={(e) => setLinkMaxUses(e.target.value)}
                                        className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                    />
                                    <p className="text-xs text-black/50">Use 1 for one-time checkout links. Leave blank for unlimited reusable links.</p>
                                </div>
                            </div>
                        )}

                        {linkError && (
                            <p className="text-red-500 text-xs sm:text-sm font-bold">{linkError}</p>
                        )}
                        {linkSuccess && (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 space-y-4 font-sans text-left text-black">
                                <p className="text-emerald-700 text-sm font-bold">
                                    Payment link created
                                </p>
                                {createdLinkInfo && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-black/10 rounded-2xl p-3.5">
                                        <span className="text-xs sm:text-sm font-mono text-black/80 truncate max-w-[190px] xs:max-w-[240px] sm:max-w-none flex-1">
                                            {createdLinkInfo.checkoutUrl}
                                        </span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveQrCodeLink(createdLinkInfo.checkoutUrl);
                                                    setActiveQrCodeTitle(createdLinkInfo.title);
                                                }}
                                                className="p-2.5 rounded-xl bg-black/5 hover:bg-black/10 border border-black/10 text-black/80 hover:text-black transition-all flex items-center justify-center"
                                                title="Show QR Code"
                                            >
                                                <QrCode className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyLink(createdLinkInfo.id, createdLinkInfo.checkoutUrl)}
                                                className="px-4 py-2 rounded-xl bg-[#D4E3E8] hover:bg-[#D4E3E8]/80 border border-black/10 text-[#082824] text-xs sm:text-sm font-bold transition-all"
                                            >
                                                {linkCopyFeedback[createdLinkInfo.id] ? "Copied!" : "Copy Link"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end pt-2">
                            <button
                                type="submit"
                                disabled={isCreatingLink || !linkTitle || !linkAmountUsdc}
                                className="px-8 py-3.5 bg-[#000000] hover:bg-black/85 disabled:opacity-50 text-white text-sm sm:text-base font-bold rounded-full transition-all flex items-center gap-2 font-sans shadow-sm"
                            >
                                <Link2 className="w-4 h-4" />
                                {isCreatingLink ? "Creating..." : "Create Link"}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Existing Payment Links List */}
                <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 text-black dark:text-white space-y-6 shadow-sm">
                    <div>
                        <h2 className="text-lg font-bold sm:text-xl text-[#082824] dark:text-white mb-1.5">Payment Links</h2>
                        <p className="text-xs sm:text-sm text-black/70 dark:text-white/70 font-sans leading-relaxed">
                            Your payment links in one place. Share them with customers or check their status.
                        </p>
                    </div>

                    <div className="relative">
                        {isLinksLoading && paymentLinks.length > 0 && (
                            <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center rounded-2xl z-20">
                                <Loader2 className="w-6 h-6 animate-spin text-[#082824]" />
                            </div>
                        )}
                        {isLinksLoading && paymentLinks.length === 0 ? (
                            <div className="space-y-3 py-3 animate-pulse">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="flex justify-between items-center bg-black/5 border border-black/5 rounded-2xl p-4">
                                        <div className="space-y-1.5">
                                            <div className="h-4 w-32 rounded bg-black/15" />
                                            <div className="h-3 w-20 rounded bg-black/10" />
                                        </div>
                                        <div className="h-4 w-16 rounded bg-black/15" />
                                        <div className="h-6 w-20 rounded-xl bg-black/10" />
                                    </div>
                                ))}
                            </div>
                        ) : paymentLinks.length === 0 ? (
                            <div className="text-center py-12 border border-black/10 dark:border-white/10 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02]">
                                <p className="text-black/50 dark:text-white/50 text-xs font-sans">No payment links created yet.</p>
                            </div>
                        ) : (
                            <>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse font-sans text-xs">
                                    <thead>
                                        <tr className="border-b border-black/10 dark:border-white/10 text-[10px] uppercase tracking-wider text-black/60 dark:text-white/60 text-left font-sans">
                                            <th className="pb-3 pr-3 font-bold w-[28%] min-w-[170px]">Title</th>
                                            <th className="pb-3 px-3 font-bold whitespace-nowrap">Amount</th>
                                            <th className="pb-3 px-3 font-bold hidden md:table-cell">Reference</th>
                                            <th className="pb-3 px-3 font-bold hidden sm:table-cell whitespace-nowrap">Expiration</th>
                                            <th className="pb-3 px-3 font-bold">Status</th>
                                            <th className="pb-3 pl-3 font-bold text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5 dark:divide-white/5 font-sans">
                                    {(() => {
                                        const linksPageSize = 5;
                                        const paginatedLinks = paymentLinks.slice(linksPage * linksPageSize, (linksPage + 1) * linksPageSize);
                                        return paginatedLinks.map((link) => {
                                            const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
                                            const isExhausted = link.max_uses != null && Number(link.use_count || 0) >= Number(link.max_uses);
                                            const status = !link.active 
                                                ? "Inactive" 
                                                : isExhausted
                                                    ? "Exhausted"
                                                    : isExpired 
                                                        ? "Expired" 
                                                        : "Active";

                                            return (
                                                <Fragment key={link.id}>
                                                    <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                                        <td className="py-3.5 pr-3 align-middle">
                                                            <div className="font-bold text-[#082824] dark:text-white text-xs sm:text-[13px] leading-tight truncate max-w-[190px] sm:max-w-[260px] md:max-w-[300px]" title={link.title}>
                                                                {link.title}
                                                            </div>
                                                            {link.description && (
                                                                <div className="text-[10px] text-black/60 dark:text-white/60 truncate max-w-[190px] sm:max-w-[260px] mt-0.5" title={link.description}>
                                                                    {link.description}
                                                                </div>
                                                            )}
                                                            {link.max_uses != null && (
                                                                <div className="text-[9px] text-black/40 dark:text-white/40 font-mono mt-0.5">
                                                                    Uses: {link.use_count || 0}/{link.max_uses}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="py-3.5 px-3 font-mono font-bold text-[#082824] dark:text-white text-xs sm:text-[13px] whitespace-nowrap align-middle">
                                                            ${(Number(link.amount_usdc) / 1000000).toFixed(2)}
                                                        </td>
                                                        <td className="py-3.5 px-3 text-black/70 dark:text-white/70 font-mono hidden md:table-cell text-[11px] truncate max-w-[130px] align-middle" title={link.external_reference || ""}>
                                                            {link.external_reference || "—"}
                                                        </td>
                                                        <td className="py-3.5 px-3 text-black/60 dark:text-white/60 hidden sm:table-cell text-[11px] whitespace-nowrap align-middle">
                                                            {link.expires_at ? new Date(link.expires_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "Never"}
                                                        </td>
                                                        <td className="py-3.5 px-3 align-middle">
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap ${
                                                                status === "Active"
                                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
                                                                    : status === "Expired"
                                                                        ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300 dark:border-amber-400/30"
                                                                        : "bg-black/5 border-black/10 text-black/50 dark:bg-white/10 dark:text-white/50 dark:border-white/10"
                                                            }`}>
                                                                {status}
                                                            </span>
                                                        </td>
                                                        <td className="py-3.5 pl-3 text-right align-middle">
                                                            <div className="flex gap-1.5 justify-end items-center font-sans">
                                                                <button
                                                                    onClick={() => handleCopyLink(link.id, link.checkoutUrl)}
                                                                    className="h-7 px-2.5 rounded-lg bg-[#D4E3E8] hover:bg-[#c6d8de] dark:bg-white/10 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 text-[#082824] dark:text-white text-[10px] font-bold transition-all flex items-center gap-1 shrink-0"
                                                                    title={linkCopyFeedback[link.id] ? "Copied!" : "Copy Link"}
                                                                >
                                                                    {linkCopyFeedback[link.id] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                                    <span className="hidden sm:inline">{linkCopyFeedback[link.id] ? "Copied!" : "Copy Link"}</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const url = getPublicCheckoutUrl(link.id, link.checkoutUrl);
                                                                        setActiveQrCodeLink(url);
                                                                        setActiveQrCodeTitle(link.title);
                                                                    }}
                                                                    className="h-7 w-7 rounded-lg bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 text-black/80 dark:text-white/80 transition-all flex items-center justify-center shrink-0"
                                                                    title="Show QR Code"
                                                                >
                                                                    <QrCode className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setExpandedLinkId(expandedLinkId === link.id ? null : link.id);
                                                                    }}
                                                                    className={`h-7 w-7 rounded-lg border transition-all flex items-center justify-center shrink-0 ${
                                                                        expandedLinkId === link.id
                                                                            ? "bg-[#D4E3E8] dark:bg-white/20 border-black/20 dark:border-white/20 text-[#082824] dark:text-white"
                                                                            : "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 text-black/80 dark:text-white/80"
                                                                    }`}
                                                                    title="Show Payments Stats"
                                                                >
                                                                    <BarChart3 className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleToggleLinkActive(link.id, link.active)}
                                                                    className={`h-7 px-2.5 rounded-lg border text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                                                                        link.active
                                                                            ? "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 dark:border-amber-400/30 text-amber-700 dark:text-amber-300"
                                                                            : "bg-[#D4E3E8] hover:bg-[#c6d8de] dark:bg-white/10 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 text-[#082824] dark:text-white"
                                                                    }`}
                                                                    title={link.active ? "Deactivate" : "Activate"}
                                                                >
                                                                    {link.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                                                    <span className="hidden sm:inline">{link.active ? "Deactivate" : "Activate"}</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteLink(link.id)}
                                                                    className="h-7 w-7 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-600 dark:text-red-400 transition-all flex items-center justify-center shrink-0"
                                                                    title="Delete Link"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {expandedLinkId === link.id && (
                                                        <tr className="bg-black/[0.01]">
                                                            <td colSpan={6} className="py-4 px-6 border-l-2 border-[#8AB4DB] bg-white rounded-r-2xl">
                                                                <div className="space-y-3 font-sans">
                                                                    <div className="flex justify-between items-center">
                                                                        <span className="text-black font-semibold text-xs">Link Stats & Payments</span>
                                                                        <span className="text-[10px] text-black/50">Total Payments: {link.payments?.length || 0}</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start border border-black/10 rounded-xl bg-black/[0.02] p-3">
                                                                        <div className="space-y-1">
                                                                            <div className="text-[10px] text-black/50 font-semibold">Link Rules</div>
                                                                            <div className="text-[11px] text-black/70">
                                                                                {link.max_uses != null ? `Uses ${link.use_count || 0}/${link.max_uses}` : "Unlimited uses"}
                                                                                {" · "}
                                                                                {link.expires_at ? `Expires ${new Date(link.expires_at).toLocaleString()}` : "No automatic expiry"}
                                                                            </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-3 gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 1440, "1")}
                                                                                className="px-3 py-2 rounded-lg border border-black/10 bg-[#D4E3E8] text-[#082824] text-[9px] font-semibold hover:bg-[#D4E3E8]/80 transition-colors"
                                                                            >
                                                                                One-Time
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 7 * 24 * 60, null)}
                                                                                className="px-3 py-2 rounded-lg border border-black/10 bg-black/5 text-black/70 text-[9px] font-semibold hover:bg-black/10 hover:text-black transition-colors"
                                                                            >
                                                                                7D Reuse
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 0, null)}
                                                                                className="px-3 py-2 rounded-lg border border-black/10 bg-black/5 text-black/70 text-[9px] font-semibold hover:bg-black/10 hover:text-black transition-colors"
                                                                            >
                                                                                No Expiry
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    {!link.payments || link.payments.length === 0 ? (
                                                                        <div className="py-4 text-center text-[11px] text-black/40 border border-dashed border-black/10 rounded-xl">
                                                                            No payments recorded for this checkout link yet.
                                                                        </div>
                                                                    ) : (
                                                                        <div className="overflow-x-auto border border-black/10 rounded-xl bg-white">
                                                                            <table className="w-full text-left border-collapse text-[10px]">
                                                                                <thead>
                                                                                    <tr className="border-b border-black/10 bg-black/[0.02] text-[9px] text-black/50 font-semibold">
                                                                                        <th className="py-2.5 px-3">Payment</th>
                                                                                        <th className="py-2.5 px-3">Tx Hash</th>
                                                                                        <th className="py-2.5 px-3">Date</th>
                                                                                        <th className="py-2.5 px-3 text-right">Amount</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="divide-y divide-black/10 font-mono text-black/70">
                                                                                    {link.payments.map((p: any) => (
                                                                                        <tr key={p.id} className="hover:bg-black/[0.02] transition-colors">
                                                                                            {/* Was the payer's alias or wallet. The API no longer sends either — a
                                                                                                merchant gets the amount and their own settlement, not who paid. */}
                                                                                            <td className="py-2 px-3 text-[#082824]">
                                                                                                {p.id ? `#${String(p.id).slice(0, 8)}` : "-"}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-black/50 hover:text-[#082824] transition-colors">
                                                                                                {p.tx_hash ? (
                                                                                                    <a 
                                                                                                        href={`${activeArcChain.blockExplorers.default.url}/tx/${p.tx_hash}`}
                                                                                                        target="_blank" 
                                                                                                        rel="noopener noreferrer"
                                                                                                    >
                                                                                                        {p.tx_hash.slice(0, 10)}...{p.tx_hash.slice(-8)}
                                                                                                    </a>
                                                                                                ) : "-"}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-black/50">
                                                                                                {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-right text-black font-sans font-semibold">
                                                                                                ${(Number(p.amount_usdc) / 1000000).toFixed(2)}
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {(() => {
                            const linksPageSize = 5;
                            const totalPages = Math.ceil(paymentLinks.length / linksPageSize);
                            if (totalPages <= 1) return null;
                            return (
                                <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 font-sans">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                        Page {linksPage + 1} of {totalPages}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={linksPage === 0}
                                            onClick={() => setLinksPage((p) => Math.max(0, p - 1))}
                                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                        >
                                            Prev
                                        </button>
                                        <button
                                            type="button"
                                            disabled={linksPage >= totalPages - 1}
                                            onClick={() => setLinksPage((p) => Math.min(totalPages - 1, p + 1))}
                                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </>
                    )}
                    </div>
                </div>
            </div>
        );
    };

    const renderPlansTab = () => {
        const activePlans = merchantPlans.filter((plan) => plan.active);
        const inactivePlans = merchantPlans.filter((plan) => !plan.active);
        /* The most recent promotion per plan (active first) drives the row's promo panel. */
        const promotionsByPlan = new Map<string, PlanPromotion>();
        for (const promo of planPromotions) {
            const existing = promotionsByPlan.get(promo.planId);
            if (!existing || (promo.active && !existing.active)) {
                promotionsByPlan.set(promo.planId, promo);
            }
        }

        return (
            <div className="space-y-8">
                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2 flex items-center gap-2.5">
                                <Sliders className="w-5 h-5 text-[#082824]" />
                                Create Subscription Plan
                            </h2>
                            <p className="text-sm sm:text-base text-black/70 font-sans leading-relaxed">
                                Publish named recurring USDC plans. Share each plan&apos;s subscribe link with customers, with no website needed.
                                The same plans power your API keys and webhooks later, so you scale without rebuilding.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={fetchMerchantPlans}
                            disabled={isPlansLoading}
                            className="rounded-full border border-black/10 bg-black/5 px-5 py-2.5 text-xs sm:text-sm font-bold text-black/80 transition hover:border-black/20 hover:text-black disabled:opacity-50 shrink-0"
                        >
                            {isPlansLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
                        </button>
                    </div>

                    <form onSubmit={handleCreatePlan} className="space-y-5 font-sans text-sm sm:text-base">
                        <div className="grid gap-4 md:grid-cols-[1.3fr_0.8fr_0.8fr] md:items-end">
                            <div className="space-y-1.5">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Plan Name</label>
                                <input
                                    type="text"
                                    value={planName}
                                    onChange={(event) => setPlanName(event.target.value)}
                                    placeholder="Pro API Access"
                                    className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">USDC Amount</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={planAmountUsdc}
                                    onChange={(event) => setPlanAmountUsdc(event.target.value)}
                                    placeholder="29.00"
                                    className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">Period Days</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="366"
                                    value={planPeriodDays}
                                    onChange={(event) => setPlanPeriodDays(event.target.value)}
                                    className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">
                                    Description <span className="font-normal text-black/50">(optional, shown to subscribers)</span>
                                </label>
                                <span className={`text-xs font-bold ${planDescription.length >= PLAN_DESCRIPTION_MAX ? "text-amber-500" : "text-black/50"}`}>
                                    {planDescription.length}/{PLAN_DESCRIPTION_MAX}
                                </span>
                            </div>
                            <textarea
                                value={planDescription}
                                onChange={(event) => setPlanDescription(event.target.value.slice(0, PLAN_DESCRIPTION_MAX))}
                                rows={3}
                                maxLength={PLAN_DESCRIPTION_MAX}
                                placeholder="What's included (features, usage limits, support level, billing terms…)"
                                className="w-full resize-none rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[#082824] font-bold text-xs sm:text-sm tracking-wide">
                                Details Link <span className="font-normal text-black/50">(optional, &ldquo;view more&rdquo;)</span>
                            </label>
                            <input
                                type="url"
                                inputMode="url"
                                value={planDetailsUrl}
                                onChange={(event) => setPlanDetailsUrl(event.target.value)}
                                placeholder="https://yoursite.com/plans/pro"
                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-black text-sm sm:text-base transition-colors focus:border-[#8AB4DB] focus:outline-none"
                            />
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                type="submit"
                                disabled={isPlansLoading}
                                className="rounded-full bg-[#000000] px-8 py-3.5 text-sm sm:text-base font-bold text-white transition hover:bg-black/85 disabled:opacity-50 shadow-sm"
                            >
                                {isPlansLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create"}
                            </button>
                        </div>
                    </form>

                    {planError && <p className="text-xs sm:text-sm font-bold text-red-500">{planError}</p>}
                    {planSuccess && <p className="text-xs sm:text-sm font-bold text-emerald-600">{planSuccess}</p>}
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                    <div className="rounded-[34px] min-w-0 overflow-hidden border border-black/10 bg-[#FFFFF0] p-4 sm:p-6 text-black space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm sm:text-base font-bold text-[#082824]">Active Plans</h3>
                            <span className="rounded-full border border-black/10 bg-[#D4E3E8] px-3.5 py-1 text-xs font-bold text-[#082824]">{activePlans.length}</span>
                        </div>
                        {activePlans.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-black/10 p-6 sm:p-8 text-center text-xs sm:text-sm text-black/50">
                                No active plans yet. Create one above to get a shareable subscribe link.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activePlans.map((plan) => (
                                    <MerchantPlanRow key={plan.id} plan={plan} busy={isPlansLoading} onToggle={handleTogglePlanActive} promotion={promotionsByPlan.get(plan.id) ?? null} onPromotionsChanged={fetchMerchantPlans} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-[34px] min-w-0 overflow-hidden border border-black/10 bg-[#FFFFF0] p-4 sm:p-6 text-black space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm sm:text-base font-bold text-[#082824]">Inactive Plans</h3>
                            <span className="rounded-full border border-black/10 bg-black/5 px-3.5 py-1 text-xs font-bold text-black/70">{inactivePlans.length}</span>
                        </div>
                        {inactivePlans.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 p-6 sm:p-8 text-center text-xs text-white/40">
                                Deactivated plans stay here for auditability.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {inactivePlans.map((plan) => (
                                    <MerchantPlanRow key={plan.id} plan={plan} busy={isPlansLoading} onToggle={handleTogglePlanActive} promotion={promotionsByPlan.get(plan.id) ?? null} onPromotionsChanged={fetchMerchantPlans} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderSettingsTab = () => {
        if (!userSettings) {
            return (
                <div className="w-full max-w-5xl space-y-8 font-sans text-black">
                    <div className="space-y-2">
                        <Skeleton className="h-7 sm:h-8 w-60 rounded-xl" />
                        <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                    </div>
                    <div className="border border-black/10 bg-[#FFFFF0] rounded-[34px] p-4 space-y-2 shadow-sm">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <div key={i} className="p-4 rounded-2xl flex items-center justify-between subscript-skeleton">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-11 h-11 rounded-2xl bg-[#082824]/10" />
                                    <div className="space-y-1.5">
                                        <div className="h-4 w-36 rounded-full bg-[#082824]/20" />
                                        <div className="h-3 w-56 rounded-full bg-black/10" />
                                    </div>
                                </div>
                                <div className="w-5 h-5 rounded-full bg-black/10" />
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        const renderBackHeader = (title: string, subtitle?: string) => (
            <div className="flex flex-col gap-1 mb-6">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setMerchantSubView("menu")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-xs sm:text-sm font-bold text-[#082824] hover:bg-black/5 transition shadow-sm"
                    >
                        <ChevronLeft className="h-4 w-4" /> Back to Settings
                    </button>
                    <h2 className="text-lg font-bold text-[#082824] uppercase tracking-wider">{title}</h2>
                </div>
                {subtitle && <p className="text-xs sm:text-sm text-black/60 mt-1 ml-1">{subtitle}</p>}
            </div>
        );

        return (
            <div className="w-full max-w-5xl space-y-8 font-sans text-black">
                {/* 1. MAIN SETTINGS MENU HUB */}
                {merchantSubView === "menu" && (
                    <div className="space-y-6">
                        <div>
                            <h1 className="text-xl font-bold text-[#082824] sm:text-2xl">Merchant Settings</h1>
                            <p className="text-sm sm:text-base text-black/70 mt-1">Manage your business profile, theme, DNS namespace, and payouts.</p>
                        </div>

                        {/* Settings Menu Options List */}
                        <div className="border border-black/10 bg-[#FFFFF0] rounded-[34px] p-4 space-y-2 shadow-sm">
                            {isAdmin && (
                                <Link
                                    href="/admin"
                                    className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                                >
                                    <div className="flex items-center gap-3.5">
                                        <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-600">
                                            <Shield className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Admin Console</span>
                                            <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Platform controls, analytics and moderation</span>
                                        </div>
                                    </div>
                                    <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                                </Link>
                            )}

                            {/* Profile & Branding */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("profile")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <User className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Profile &amp; Branding</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Logo, alias, payout destination, and cancellation feedback</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Appearance & Theme */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("appearance")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <Sliders className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Appearance &amp; Theme</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Switch between Light, Dark, and System mode</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* SubScript DNS */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("dns")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <Globe className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">SubScript DNS</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Register your business namespace (.hq / .biz)</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* KYC Verification & Plan */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("kyc")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <ShieldCheck className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">KYC Verification &amp; Tier</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Business trust badge and verification status</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Failed-Renewal Policy (Dunning) */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("dunning")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <ArrowRightLeft className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Failed-Renewal Policy</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Configure automated retry attempts (dunning)</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Transactions & Receipt History */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("transactions")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <Activity className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Transaction Logs</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Filter and search payment receipt records</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Notifications & Alerts */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("notifications")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <Bell className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Notifications &amp; Alerts</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Push, email, and payout alert preferences</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Security & Backup */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("security")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <Lock className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Security &amp; Wallet Recovery</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Export merchant private key and multi-sig</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>

                            {/* Help & Support */}
                            <button
                                type="button"
                                onClick={() => setMerchantSubView("support")}
                                className="w-full text-left p-4 hover:bg-black/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="p-3 rounded-2xl bg-black/5 text-[#082824] group-hover:bg-[#082824] group-hover:text-white transition-all">
                                        <HelpCircle className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="block text-sm sm:text-base font-bold text-[#082824] tracking-wide">Help &amp; Support</span>
                                        <span className="block text-xs sm:text-sm text-black/60 mt-0.5">Integration docs, contact team, compliance</span>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-black/30 group-hover:text-black/70 group-hover:translate-x-0.5 transition-all" />
                            </button>
                        </div>
                    </div>
                )}

                {/* 2. APPEARANCE & THEME SUBVIEW */}
                {merchantSubView === "appearance" && (
                    <div className="space-y-6">
                        {renderBackHeader("Appearance & Theme", "Customize how your merchant portal looks.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div>
                                <h3 className="text-base font-bold text-[#082824]">Dashboard Theme</h3>
                                <p className="text-xs text-black/60 mt-1">
                                    Choose your preferred color theme for the SubScript merchant dashboard.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                                {[
                                    {
                                        id: "light" as const,
                                        title: "Light Mode",
                                        previewBg: "bg-[#FFFFF0] border-black/20 text-[#082824]",
                                        badge: "bg-[#D4E3E8] text-[#082824]",
                                    },
                                    {
                                        id: "dark" as const,
                                        title: "Dark Mode",
                                        previewBg: "bg-[#082824] border-white/20 text-white",
                                        badge: "bg-[#8AB4DB] text-[#082824]",
                                    },
                                    {
                                        id: "system" as const,
                                        title: "System Default",
                                        previewBg: "bg-slate-100 border-slate-300 text-slate-900",
                                        badge: "bg-slate-200 text-slate-800",
                                    },
                                ].map((t) => {
                                    const isSelected = theme === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setTheme(t.id)}
                                            className={`flex flex-col justify-between p-4 rounded-2xl border text-left transition-all relative ${
                                                isSelected
                                                    ? "border-[#082824] ring-2 ring-[#082824]/20 shadow-md bg-black/[0.02]"
                                                    : "border-black/10 hover:border-black/25 bg-white"
                                            }`}
                                        >
                                            <div className="space-y-2">
                                                <div data-theme-preview="true" className={`h-16 w-full rounded-xl border p-2.5 flex flex-col justify-between ${t.previewBg}`}>
                                                    <div className="flex items-center justify-between">
                                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${t.badge}`}>
                                                            {t.title}
                                                        </span>
                                                        {isSelected && <Check className="h-4 w-4 text-emerald-600" />}
                                                    </div>
                                                    <div className="h-2 w-16 rounded-full bg-current opacity-30" />
                                                </div>
                                                <div className="pt-1">
                                                    <p className="font-bold text-xs text-black">{t.title}</p>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* 3. PROFILE & BRANDING SUBVIEW */}
                {merchantSubView === "profile" && (
                    <div className="space-y-6">
                        {renderBackHeader("Profile & Branding", "Manage your merchant logo, identity, and cancellation feedback question.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                            <div className="flex flex-col md:flex-row items-start md:items-center gap-6 pb-6 border-b border-black/10">
                                <div className="relative group shrink-0">
                                    <div className="w-20 h-20 rounded-full border border-black/15 overflow-hidden bg-[#D4E3E8] flex items-center justify-center text-[#082824] relative">
                                        {userSettings.profilePic ? (
                                            <img src={userSettings.profilePic} alt="Merchant Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-8 h-8 text-[#082824]" />
                                        )}
                                        {uploadingPic && (
                                            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                                                <Loader2 className="w-5 h-5 animate-spin text-[#082824]" />
                                            </div>
                                        )}
                                    </div>
                                    <label className="absolute -bottom-1 -right-1 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] p-1.5 rounded-full cursor-pointer shadow-sm hover:scale-105 active:scale-95 transition-all">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                                    </label>
                                </div>

                                <div className="flex-1 space-y-1">
                                    <h3 className="text-sm font-semibold text-black">Merchant Profile Photo</h3>
                                    <p className="text-[10px] text-black/60 leading-relaxed font-sans max-w-sm">
                                        Upload a brand logo or profile picture. JPG/PNG, maximum 2MB size limit.
                                    </p>
                                    {uploadError && <p className="text-[10px] text-red-500 mt-1 font-sans">{uploadError}</p>}
                                </div>
                            </div>

                            {/* Payout Destination */}
                            <div className="space-y-4 pt-2">
                                <h3 className="text-xs font-semibold text-black flex items-center gap-2">
                                    <Wallet className="w-4 h-4 text-[#082824]" /> Payout Destination Address
                                </h3>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={payoutDestinationDraft}
                                        placeholder="0x..."
                                        onChange={(e) => { setPayoutDestinationDraft(e.target.value); setPayoutDestinationError(null); }}
                                        className="flex-1 bg-white border border-black/15 rounded-xl px-4 py-2.5 text-black text-xs focus:outline-none focus:border-[#8AB4DB] font-mono"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleUpdatePayoutDestination(payoutDestinationDraft)}
                                        disabled={savingSettingsField === "payoutDestination" || payoutDestinationDraft.trim() === (userSettings.payoutDestination || "")}
                                        className="rounded-full bg-[#8AB4DB] hover:bg-[#7aa7d0] px-5 py-2.5 text-xs font-semibold text-[#082824] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {savingSettingsField === "payoutDestination" ? "Saving…" : "Save Destination"}
                                    </button>
                                </div>
                                {payoutDestinationError && <p className="text-[10px] text-red-500" role="alert">{payoutDestinationError}</p>}
                            </div>

                            {/* Cancellation Feedback Question */}
                            <div className="space-y-3 pt-4 border-t border-black/10">
                                <h3 className="text-xs font-semibold text-black flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-[#082824]" /> Cancellation Feedback Question
                                </h3>
                                <p className="text-[11px] text-black/60">
                                    Ask cancelling customers your own question to understand why they left. Leave blank to use the default message.
                                </p>
                                <textarea
                                    value={churnQuestionDraft}
                                    onChange={(e) => setChurnQuestionDraft(e.target.value)}
                                    maxLength={280}
                                    rows={3}
                                    placeholder="e.g. What could we have done to keep you subscribed?"
                                    className="w-full resize-none rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs text-black placeholder:text-black/30 focus:border-[#8AB4DB] focus:outline-none"
                                />
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-black/40">{churnQuestionDraft.length}/280</span>
                                    <button
                                        type="button"
                                        onClick={() => handleUpdateChurnSurveyQuestion(churnQuestionDraft)}
                                        disabled={savingSettingsField === "churnSurveyQuestion" || (churnQuestionDraft.trim() === (userSettings?.churnSurveyQuestion || ""))}
                                        className="px-5 py-2 text-xs font-semibold rounded-full bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                    >
                                        {savingSettingsField === "churnSurveyQuestion" ? "Saving..." : "Save Question"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. SUBSCRIPT DNS SUBVIEW */}
                {merchantSubView === "dns" && (
                    <div className="space-y-6">
                        {renderBackHeader("SubScript DNS", "Configure your business namespace on Arc.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-4 shadow-sm">
                            <h3 className="text-xs font-semibold text-black">SubScript DNS Registration (Business Name)</h3>
                            <p className="text-[10px] leading-relaxed text-amber-900 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 font-sans">
                                {merchantAliasNextChange
                                    ? <>Your DNS name is locked until <strong>{new Date(merchantAliasNextChange).toLocaleDateString()}</strong>. You can change it again then. Business names cannot be unregistered.</>
                                    : <>Heads up: a DNS name can only be changed <strong>once every 365 days</strong>. Choose carefully, because after a change you won&apos;t be able to switch again for a year.</>}
                            </p>
                            {userSettings.alias ? (
                                <div className="p-4 rounded-2xl border border-black/10 bg-[#D4E3E8] flex items-center justify-between">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider font-semibold text-black/60">Registered Alias</p>
                                        <h4 className="font-mono text-lg font-bold text-[#082824] mt-1">{userSettings.alias}</h4>
                                    </div>
                                    <span className="px-3 py-1.5 border border-black/15 bg-white text-black/70 text-[10px] font-semibold rounded-full select-none">
                                        Permanent
                                    </span>
                                </div>
                            ) : dnsConfirmPending ? (
                                <div className="p-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-400/10 dark:border-amber-400/30 space-y-4">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider font-semibold text-black/60 dark:text-white/60">Confirm DNS name</p>
                                        <h4 className="font-mono text-lg font-bold text-[#082824] dark:text-white mt-1">{dnsConfirmPending}</h4>
                                    </div>
                                    <p className="text-[10px] leading-relaxed text-black/70">
                                        This is locked for <strong>365 days</strong> once registered. Make sure it&apos;s right.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setDnsConfirmPending(null)}
                                            disabled={dnsLoading}
                                            className="flex-1 py-2.5 border border-black/15 bg-white hover:bg-black/5 text-black/70 text-[10px] font-semibold rounded-full transition-all"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmDnsRegistration}
                                            disabled={dnsLoading}
                                            className="flex-1 py-2.5 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] text-[10px] font-semibold rounded-full transition-all flex items-center justify-center gap-2"
                                        >
                                            {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & Register"}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleRegisterDns} className="space-y-3 font-sans text-xs">
                                    <div className="space-y-1">
                                        <label className="text-black/60 font-semibold text-[10px] tracking-wide">Domain Alias</label>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    type="text"
                                                    value={dnsDomain}
                                                    onChange={(e) => setDnsDomain(e.target.value)}
                                                    placeholder="my-company"
                                                    className="w-full bg-white border border-black/15 rounded-xl px-4 py-2.5 text-black focus:outline-none focus:border-[#8AB4DB] font-mono"
                                                    required
                                                />
                                                <div className="absolute right-3 top-2.5 flex gap-1">
                                                    <select
                                                        value={dnsSuffix}
                                                        onChange={(e) => setDnsSuffix(e.target.value)}
                                                        className="bg-transparent text-black/60 text-xs font-bold border-none focus:outline-none cursor-pointer"
                                                    >
                                                        <option value=".hq" className="bg-white text-black">.hq</option>
                                                        <option value=".biz" className="bg-white text-black">.biz</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={dnsLoading}
                                                className="px-6 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] font-semibold rounded-full transition-all"
                                            >
                                                {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register"}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-black/50">
                                            Enterprise custom namespaces allow customers to identify your business link securely.
                                        </p>
                                    </div>
                                </form>
                            )}
                            {dnsError && <p className="text-[10px] text-red-500">{dnsError}</p>}
                            {dnsSuccess && <p className="text-[10px] text-emerald-600">{dnsSuccess}</p>}
                        </div>
                    </div>
                )}

                {/* 5. KYC & PLAN SUBVIEW */}
                {merchantSubView === "kyc" && (
                    <div className="space-y-6">
                        {renderBackHeader("KYC Verification & Tier", "Identity verification and platform trust badges.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className={`p-4 rounded-2xl border ${userSettings.verified ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'} space-y-2`}>
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-black">KYC Tier</h4>
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${userSettings.verified ? 'bg-emerald-500/20 text-emerald-800' : 'bg-amber-500/20 text-amber-800'}`}>
                                            {userSettings.verified ? 'Verified' : 'Unverified'}
                                        </span>
                                    </div>
                                    <ul className="space-y-1 text-[10px] text-black/70 leading-relaxed font-sans">
                                        {userSettings.verified ? (
                                            <>
                                                <li className="flex items-center gap-1 text-emerald-700">✓ Verified badge on your public profile</li>
                                                <li className="flex items-center gap-1 text-emerald-700">✓ Customers can commit without a risk warning</li>
                                                <li className="flex items-center gap-1 text-emerald-700">✓ Ready for regulated rails as they launch</li>
                                            </>
                                        ) : (
                                            <>
                                                <li className="flex items-center gap-1 text-black/60">• Public profile shows unverified</li>
                                                <li className="flex items-center gap-1 text-black/60">• Customers see a warning before committing funds</li>
                                                <li className="flex items-center gap-1 text-black/60">• Complete business verification below to upgrade</li>
                                            </>
                                        )}
                                    </ul>
                                </div>

                                <div className={`p-4 rounded-2xl border ${userSettings.tier === 'PREMIUM' ? 'border-[#8AB4DB]/40 bg-[#D4E3E8]' : 'border-black/10 bg-black/[0.02]'} space-y-2`}>
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-black">Plan Tier</h4>
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${userSettings.tier === 'PREMIUM' ? 'bg-[#8AB4DB] text-[#082824]' : 'bg-black/10 text-black/70'}`}>
                                            {userSettings.tier === 'PREMIUM' ? 'Premium' : 'Free'}
                                        </span>
                                    </div>
                                    <ul className="space-y-1 text-[10px] text-black/70 leading-relaxed font-sans">
                                        <li className="flex items-center gap-1 text-emerald-700">✓ Create unlimited payment links</li>
                                        <li className={`flex items-center gap-1 ${userSettings.tier === 'PREMIUM' ? 'text-emerald-700' : 'text-red-500'}`}>
                                            {userSettings.tier === 'PREMIUM' ? '✓' : '✗'} API Keys &amp; Webhook endpoints
                                        </li>
                                        <li className={`flex items-center gap-1 ${userSettings.tier === 'PREMIUM' ? 'text-emerald-700' : 'text-red-500'}`}>
                                            {userSettings.tier === 'PREMIUM' ? '✓' : '✗'} Customer commitment vaults
                                        </li>
                                    </ul>
                                </div>
                            </div>

                            {/* Identity Verification (KYC/KYB) */}
                            <KycVerificationPanel />
                        </div>
                    </div>
                )}

                {/* 6. DUNNING / FAILED-RENEWAL POLICY SUBVIEW */}
                {merchantSubView === "dunning" && (
                    <div className="space-y-6">
                        {renderBackHeader("Failed-Renewal Policy", "Manage automatic keeper retries and customer grace periods.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-4 shadow-sm">
                            <div>
                                <h2 className="text-sm font-semibold text-black mb-2 flex items-center gap-2">
                                    <ArrowRightLeft className="w-4 h-4 text-[#082824]" />
                                    Keeper Retry Settings (Dunning)
                                </h2>
                                <p className="text-[11px] text-black/60 font-sans">
                                    When a customer&apos;s renewal fails (insufficient balance), the keeper retries roughly
                                    once a day. Choose how many attempts to make before the subscription is stopped and the
                                    customer is notified. More attempts ≈ more days of grace.
                                </p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 sm:items-center font-sans">
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    step="1"
                                    value={dunningMaxFailures}
                                    onChange={(e) => setDunningMaxFailures(e.target.value)}
                                    className="w-full sm:w-32 bg-white border border-black/15 rounded-xl px-4 py-3 text-black text-xs focus:outline-none focus:border-[#8AB4DB] transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={handleSaveDunning}
                                    disabled={dunningSaving}
                                    className="w-full sm:w-auto shrink-0 px-6 py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] disabled:opacity-50 text-[#082824] text-xs font-semibold rounded-full transition-all flex items-center justify-center gap-2"
                                >
                                    {dunningSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    Save Policy
                                </button>
                                {dunningMessage && (
                                    <span className="text-[10px] text-black/60">{dunningMessage}</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 7. TRANSACTIONS & RECEIPTS SUBVIEW */}
                {merchantSubView === "transactions" && (
                    <div className="space-y-6">
                        {renderBackHeader("Transaction Logs", "Search, filter, and review settlement receipt logs.")}

                        {(() => {
                            const filteredSettingsTx = settingsTransactions.filter((tx) => {
                                if (settingsTxSearch.trim()) {
                                    const q = settingsTxSearch.trim().toLowerCase();
                                    const matchId = (tx.receiptId || "").toLowerCase().includes(q);
                                    const matchHash = (tx.txHash || "").toLowerCase().includes(q);
                                    const matchMemo = (tx.memoNote || "").toLowerCase().includes(q);
                                    /* Counterparty name and payer address are intentionally not
                                       searchable here. The table never displays them, and matching
                                       on them would let a merchant confirm whether a specific
                                       address or alias had paid them. */
                                    if (!matchId && !matchHash && !matchMemo) {
                                        return false;
                                    }
                                }

                                if (settingsTxCategory !== "all") {
                                    const memo = (tx.memoNote || "").toLowerCase();
                                    const isSub = memo.includes("sub") || memo.includes("plan") || memo.includes("recurring") || !!tx.paymentLinkId;
                                    const isTransfer = memo.includes("transfer") || memo.includes("peer");
                                    const isWithdrawal = memo.includes("withdraw") || memo.includes("balance to wallet");
                                    const isOneTime = !isSub && !isTransfer && !isWithdrawal;

                                    if (settingsTxCategory === "subscriptions") {
                                        if (!isSub) return false;
                                    } else if (settingsTxCategory === "one-time") {
                                        if (!isOneTime) return false;
                                    } else if (settingsTxCategory === "transfers") {
                                        if (!isTransfer) return false;
                                    } else if (settingsTxCategory === "withdrawals") {
                                        if (!isWithdrawal) return false;
                                    } else if (settingsTxCategory === "sent") {
                                        const isOutgoing = tx.payerAddress.toLowerCase() === address.toLowerCase();
                                        if (!isOutgoing) return false;
                                    } else if (settingsTxCategory === "received") {
                                        const isOutgoing = tx.payerAddress.toLowerCase() === address.toLowerCase();
                                        if (isOutgoing) return false;
                                    }
                                }

                                if (settingsTxStatus !== "all") {
                                    if (String(tx.status || "").toUpperCase() !== settingsTxStatus.toUpperCase()) {
                                        return false;
                                    }
                                }

                                if (settingsTxDatePreset !== "all" || settingsTxStartDate || settingsTxEndDate) {
                                    const txDate = new Date(tx.createdAt).getTime();
                                    const now = Date.now();

                                    if (settingsTxDatePreset === "today") {
                                        const todayStart = new Date();
                                        todayStart.setHours(0, 0, 0, 0);
                                        if (txDate < todayStart.getTime()) return false;
                                    } else if (settingsTxDatePreset === "7days") {
                                        if (txDate < now - 7 * 24 * 60 * 60 * 1000) return false;
                                    } else if (settingsTxDatePreset === "30days") {
                                        if (txDate < now - 30 * 24 * 60 * 60 * 1000) return false;
                                    } else if (settingsTxDatePreset === "custom") {
                                        if (settingsTxStartDate) {
                                            const startMs = new Date(settingsTxStartDate).getTime();
                                            if (!isNaN(startMs) && txDate < startMs) return false;
                                        }
                                        if (settingsTxEndDate) {
                                            const endMs = new Date(settingsTxEndDate).setHours(23, 59, 59, 999);
                                            if (!isNaN(endMs) && txDate > endMs) return false;
                                        }
                                    }
                                }

                                return true;
                            });

                            return (
                                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                                    <div className="space-y-4">
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={settingsTxSearch}
                                                onChange={(e) => setSettingsTxSearch(e.target.value)}
                                                placeholder="Search by receipt ID, hash, or wallet address..."
                                                className="w-full bg-white border border-black/15 rounded-xl pl-9 pr-4 py-2.5 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                            />
                                            <Search className="w-4 h-4 text-black/40 absolute left-3 top-3" />
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            <select
                                                value={settingsTxCategory}
                                                onChange={(e) => setSettingsTxCategory(e.target.value)}
                                                className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                            >
                                                <option value="all">All Types</option>
                                                <option value="subscriptions">Subscriptions</option>
                                                <option value="one-time">One-Time</option>
                                                <option value="transfers">Transfers</option>
                                                <option value="withdrawals">Withdrawals</option>
                                            </select>

                                            <select
                                                value={settingsTxStatus}
                                                onChange={(e) => setSettingsTxStatus(e.target.value)}
                                                className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                            >
                                                <option value="all">All Statuses</option>
                                                <option value="COMPLETED">Completed</option>
                                                <option value="PENDING">Pending</option>
                                                <option value="FAILED">Failed</option>
                                            </select>

                                            <select
                                                value={settingsTxDatePreset}
                                                onChange={(e) => setSettingsTxDatePreset(e.target.value)}
                                                className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                            >
                                                <option value="all">All Time</option>
                                                <option value="today">Today</option>
                                                <option value="7days">Last 7 Days</option>
                                                <option value="30days">Last 30 Days</option>
                                                <option value="custom">Custom Date</option>
                                            </select>

                                            {(settingsTxCategory !== "all" || settingsTxStatus !== "all" || settingsTxDatePreset !== "all" || settingsTxSearch) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSettingsTxSearch("");
                                                        setSettingsTxCategory("all");
                                                        setSettingsTxStatus("all");
                                                        setSettingsTxDatePreset("all");
                                                        setSettingsTxStartDate("");
                                                        setSettingsTxEndDate("");
                                                    }}
                                                    className="px-3 py-1.5 rounded-full bg-black/5 hover:bg-black/10 text-[11px] font-semibold text-black/80 transition-all"
                                                >
                                                    Reset Filters
                                                </button>
                                            )}
                                        </div>

                                        {settingsTxDatePreset === "custom" && (
                                            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-black/70">
                                                <div className="flex items-center gap-1.5">
                                                    <span>From:</span>
                                                    <input
                                                        type="date"
                                                        value={settingsTxStartDate}
                                                        onChange={(e) => setSettingsTxStartDate(e.target.value)}
                                                        className="bg-white border border-black/15 rounded-xl px-2.5 py-1 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span>To:</span>
                                                    <input
                                                        type="date"
                                                        value={settingsTxEndDate}
                                                        onChange={(e) => setSettingsTxEndDate(e.target.value)}
                                                        className="bg-white border border-black/15 rounded-xl px-2.5 py-1 text-xs text-black focus:outline-none focus:border-[#8AB4DB]"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left font-sans text-xs">
                                            <thead>
                                                <tr className="border-b border-black/10 text-black/50 uppercase text-[9px] tracking-wider font-semibold">
                                                    <th className="pb-3">Receipt ID</th>
                                                    <th className="pb-3">Date &amp; Time</th>
                                                    <th className="pb-3">Type</th>
                                                    <th className="pb-3">Amount</th>
                                                    <th className="pb-3">Status</th>
                                                    <th className="pb-3 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredSettingsTx.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={6} className="text-center py-6 text-black/40">
                                                            No transaction logs match your active filters.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredSettingsTx.map((tx) => {
                                                        const isOutgoing = tx.payerAddress.toLowerCase() === address.toLowerCase();
                                                        return (
                                                            <tr key={tx.receiptId} className="border-b border-black/10 hover:bg-black/[0.01] transition-all">
                                                                <td className="py-4 font-mono font-semibold text-black/80">{tx.receiptId.slice(0, 8)}...</td>
                                                                <td className="py-4 text-black/60">{new Date(tx.createdAt).toLocaleString()}</td>
                                                                <td className="py-4">
                                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider ${isOutgoing ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700"}`}>
                                                                        {isOutgoing ? "Debit" : "Credit"}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 font-mono font-bold text-[#082824]">
                                                                    ${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)}
                                                                </td>
                                                                <td className="py-4">
                                                                    <FinancialStatusBadge status={tx.status} />
                                                                </td>
                                                                <td className="py-4 text-right">
                                                                    <div className="inline-flex items-center gap-3">
                                                                        <a
                                                                            href={`/receipt/${tx.receiptId}?invite=1`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-black/60 hover:text-[#082824] hover:underline inline-flex items-center gap-1"
                                                                            title="Grant another address permission to view this private receipt"
                                                                        >
                                                                            Grant access
                                                                        </a>
                                                                        <a
                                                                            href={`${activeArcChain.blockExplorers.default.url}/tx/${tx.txHash}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-[#082824] hover:underline inline-flex items-center gap-1 font-semibold"
                                                                        >
                                                                            Tx <ExternalLink className="w-3 h-3" />
                                                                        </a>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* 8. NOTIFICATIONS & ALERTS SUBVIEW */}
                {merchantSubView === "notifications" && (
                    <div className="space-y-6">
                        {renderBackHeader("Notifications & Alerts", "Configure delivery channels and webhook preferences.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                            <div className="space-y-4 font-sans text-xs">
                                <div className="flex items-center justify-between opacity-50 select-none cursor-not-allowed">
                                    <div className="space-y-0.5">
                                        <p className="text-black font-semibold flex items-center gap-1.5">Push Notifications <span className="text-[8px] bg-black/5 text-black/60 px-1.5 py-0.5 rounded font-bold uppercase">Soon</span></p>
                                        <p className="text-[10px] text-black/50">Merchant inbox alerts are not live yet</p>
                                    </div>
                                    <button
                                        onClick={() => {}}
                                        disabled={true}
                                        className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-black/10 opacity-50"
                                    >
                                        <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black/30 shadow translate-x-0" />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between opacity-50 select-none cursor-not-allowed">
                                    <div className="space-y-0.5">
                                        <p className="text-black font-semibold flex items-center gap-1.5">Email Alerts <span className="text-[8px] bg-black/5 text-black/60 px-1.5 py-0.5 rounded font-bold uppercase">Soon</span></p>
                                        <p className="text-[10px] text-black/50">Get payout summaries by email</p>
                                    </div>
                                    <button
                                        onClick={() => {}}
                                        disabled={true}
                                        className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-black/10 opacity-50"
                                    >
                                        <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black/30 shadow translate-x-0" />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between opacity-50 select-none cursor-not-allowed">
                                    <div className="space-y-0.5">
                                        <p className="text-black font-semibold flex items-center gap-1.5">Payout Alerts <span className="text-[8px] bg-black/5 text-black/60 px-1.5 py-0.5 rounded font-bold uppercase">Soon</span></p>
                                        <p className="text-[10px] text-black/50">You&apos;ll get payout alerts in your inbox once payments start coming in</p>
                                    </div>
                                    <button
                                        onClick={() => {}}
                                        disabled={true}
                                        className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-black/10 opacity-50"
                                    >
                                        <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black/30 shadow translate-x-0" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 9. SECURITY & BACKUP SUBVIEW */}
                {merchantSubView === "security" && (
                    <div className="space-y-6">
                        {renderBackHeader("Security & Wallet Recovery", "Merchant wallet key export and multi-sig authorization.")}

                        <div className="space-y-6">
                            {/* Wallet Recovery & Backup */}
                            {userSettings.walletBackup?.available && (
                                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-5 shadow-sm">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <h2 className="text-sm font-semibold text-black mb-2 flex items-center gap-2">
                                                <Lock className="w-4 h-4 text-[#082824]" />
                                                Wallet Recovery &amp; Backup
                                            </h2>
                                            <p className="text-[11px] text-black/60 font-sans leading-relaxed max-w-xl">
                                                Export the private key for your email-created merchant wallet after email verification.
                                                Importing this key into a wallet app lets you use <strong className="text-black/80">Sign in with Wallet</strong> and
                                                opens this same merchant account.
                                            </p>
                                        </div>
                                        <span className="self-start rounded-full border border-black/10 bg-[#D4E3E8] px-3 py-1 text-[9px] font-semibold text-[#082824]">
                                            Exportable
                                        </span>
                                    </div>

                                    {merchantExportedPrivateKey && (
                                        <div className="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                                            <p className="text-[10px] font-bold text-amber-900">
                                                Keep this secret offline. SubScript will never ask you to paste it into the app.
                                            </p>
                                            <div className="flex items-center gap-2 rounded-xl border border-black/15 bg-white px-3 py-2.5">
                                                <code className="min-w-0 flex-1 truncate text-[10px] text-black/80">
                                                    {merchantPrivateKeyVisible ? merchantExportedPrivateKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                                                </code>
                                                <button
                                                    type="button"
                                                    onClick={() => setMerchantPrivateKeyVisible((visible) => !visible)}
                                                    className="p-1.5 text-black/40 hover:text-black"
                                                    aria-label={merchantPrivateKeyVisible ? "Hide private key" : "Show private key"}
                                                >
                                                    {merchantPrivateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopy(merchantExportedPrivateKey, "Merchant Wallet Private Key")}
                                                    className="p-1.5 text-black/40 hover:text-black"
                                                    aria-label="Copy private key"
                                                >
                                                    {copiedText === "Merchant Wallet Private Key"
                                                        ? <Check className="h-4 w-4 text-[#082824]" />
                                                        : <Copy className="h-4 w-4" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={downloadMerchantWalletBackup}
                                                    className="p-1.5 text-black/40 hover:text-black"
                                                    aria-label="Download private key backup"
                                                >
                                                    <ArrowDownToLine className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {merchantWalletBackupError && (
                                        <p className="text-[11px] text-red-500">{merchantWalletBackupError}</p>
                                    )}

                                    {merchantExportOtpStage ? (
                                        <div className="space-y-3">
                                            <p className="text-[10px] text-black/60">
                                                Enter the 6-digit code sent to {userSettings.walletBackup.email}.
                                            </p>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="one-time-code"
                                                maxLength={6}
                                                value={merchantExportOtpCode}
                                                onChange={(event) => setMerchantExportOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                                                placeholder="000000"
                                                className="w-full rounded-2xl border border-black/15 bg-white px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-black placeholder:text-black/30 focus:border-[#8AB4DB] focus:outline-none"
                                            />
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <button
                                                    type="button"
                                                    onClick={handleMerchantWalletExport}
                                                    disabled={merchantWalletBackupLoading || merchantExportOtpCode.length !== 6}
                                                    className="w-full rounded-full bg-[#8AB4DB] hover:bg-[#7aa7d0] py-3 text-xs font-semibold text-[#082824] transition disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {merchantWalletBackupLoading ? "Unlocking…" : "Confirm & Reveal"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setMerchantExportOtpStage(false);
                                                        setMerchantExportOtpCode("");
                                                        setMerchantWalletBackupError(null);
                                                    }}
                                                    disabled={merchantWalletBackupLoading}
                                                    className="w-full rounded-full border border-black/15 bg-white hover:bg-black/5 py-3 text-xs font-semibold text-black/70 transition disabled:opacity-50"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={requestMerchantExportOtp}
                                            disabled={merchantExportOtpSending}
                                            className="w-full rounded-full bg-[#8AB4DB] hover:bg-[#7aa7d0] py-3.5 text-xs font-semibold text-[#082824] transition disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {merchantExportOtpSending ? "Sending verification code…" : "Verify email & export wallet"}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Security Toggles */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-4 shadow-sm">
                                <div>
                                    <h2 className="text-sm font-semibold text-black mb-2 flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-[#082824]" />
                                        Advanced Security
                                    </h2>
                                    <p className="text-[11px] text-black/60 font-sans">
                                        Configure multi-sig and secondary confirmation controls.
                                    </p>
                                </div>

                                <div className="space-y-4 font-sans text-xs">
                                    <div className="flex items-center justify-between opacity-50 select-none cursor-not-allowed">
                                        <div className="space-y-0.5">
                                            <p className="text-black font-semibold flex items-center gap-1.5">Multi-Sig Payout Verification <span className="text-[8px] bg-black/5 text-black/60 px-1.5 py-0.5 rounded font-bold uppercase">Soon</span></p>
                                            <p className="text-[10px] text-black/50">Require secondary signature verification for payouts</p>
                                        </div>
                                        <button
                                            onClick={() => {}}
                                            disabled={true}
                                            className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-black/10 opacity-50"
                                        >
                                            <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black/30 shadow translate-x-0" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 10. HELP & SUPPORT SUBVIEW */}
                {merchantSubView === "support" && (
                    <div className="space-y-6">
                        {renderBackHeader("Help & Support", "Get help with integrations, smart contracts, and billing.")}

                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                            <div>
                                <h2 className="text-sm font-semibold text-black mb-2 flex items-center gap-2">
                                    <HelpCircle className="w-4 h-4 text-[#082824]" />
                                    SubScript Merchant Support
                                </h2>
                                <p className="text-[11px] text-black/60 font-sans">
                                    Integration help, activation issues, billing questions, or security disclosures. Real
                                    humans read every message.
                                </p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 font-sans text-xs">
                                <button
                                    type="button"
                                    onClick={() => setSupportChatOpen(true)}
                                    className="flex flex-col justify-between rounded-2xl border border-[#082824] bg-[#082824] px-4 py-3 text-left transition hover:bg-[#0c3933] shadow-sm text-white group"
                                >
                                    <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-300">Live Support</span>
                                    <span className="mt-1 block font-bold text-xs text-white">Start Support Chat &rarr;</span>
                                </button>
                                <a
                                    href="mailto:support@subscriptonarc.com"
                                    className="rounded-2xl border border-black/10 bg-[#D4E3E8]/40 px-4 py-3 transition hover:bg-[#D4E3E8]"
                                >
                                    <span className="block text-[9px] font-semibold uppercase tracking-wider text-black/50">General support</span>
                                    <span className="mt-1 block break-all font-mono text-[10px] font-bold text-[#082824]">support@subscriptonarc.com</span>
                                </a>
                                <a
                                    href="mailto:compliance@subscriptonarc.com"
                                    className="rounded-2xl border border-black/10 bg-[#D4E3E8]/40 px-4 py-3 transition hover:bg-[#D4E3E8]"
                                >
                                    <span className="block text-[9px] font-semibold uppercase tracking-wider text-black/50">Billing &amp; Compliance</span>
                                    <span className="mt-1 block break-all font-mono text-[10px] font-bold text-[#082824]">compliance@subscriptonarc.com</span>
                                </a>
                                <a
                                    href="/support"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-[11px] font-semibold text-black transition hover:bg-black/5"
                                >
                                    Open Help Center
                                </a>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderView = () => {
        if (isConnected && address && !sessionWallet && !embeddedWallet) {
            return (
                <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-xl text-black font-sans mt-12">
                    <Shield className="w-10 h-10 mx-auto text-[#082824]" />
                    <h2 className="text-lg font-semibold text-black">Verify Wallet Ownership</h2>
                    <p className="text-xs text-black/60 leading-relaxed max-w-xs mx-auto">
                        To protect your account configurations, stats, and settings, please sign a secure message using your connected wallet.
                    </p>
                    <button
                        onClick={handleBackendLogin}
                        disabled={isLoggingIn}
                        className="w-full py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                        {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-[#082824]" /> : <Shield className="w-4 h-4" />}
                        Authenticate Developer Portal
                    </button>
                </div>
            );
        }

        // Developer tools (API keys, checkout, webhooks) remain accessible to standard and premium merchants alike.



        const renderCommitTab = () => {
            if (!isPremium) {
                return renderPremiumLock("Vault Commits Setup");
            }

            return (
                <div className="space-y-8 font-sans">
                    {/* Vault Config Form and Claim Settlement */}
                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                                <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2 flex items-center gap-2.5">
                                    <ShieldCheck className="w-5 h-5 text-[#082824]" />
                                    Customer Deposits
                                </h2>
                                <p className="text-sm sm:text-base text-black/70 font-sans leading-relaxed">
                                    Manage customer deposits, withdraw earnings, and check balances.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    fetchVaultOps();
                                    fetchVaults();
                                }}
                                disabled={isVaultOpsLoading || isVaultsLoading}
                                className="rounded-full border border-black/10 bg-black/5 hover:bg-black/10 px-5 py-2.5 text-xs sm:text-sm font-bold text-[#082824] transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${(isVaultOpsLoading || isVaultsLoading) ? "animate-spin" : ""}`} />
                                Refresh
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Claim Settled Funds card */}
                            <div className="rounded-[28px] border border-black/10 bg-[#D4E3E8] p-6 flex flex-col justify-between gap-4">
                                <div>
                                    <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#082824]/70">Ready to Withdraw</p>
                                    <p className="text-3xl sm:text-4xl font-black text-[#082824] mt-2">${formatUsdcMicros(claimableAmount)}</p>
                                    <p className="text-xs text-[#082824]/70 mt-1">
                                        Earnings become available to withdraw after each billing cycle completes.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleClaimVaultFunds}
                                    disabled={isClaimingVault || isVaultOpsLoading || microsToNumber(claimableAmount) <= 0}
                                    className="w-full py-3.5 bg-[#000000] hover:bg-black/85 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                                >
                                    {isClaimingVault ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4 text-white" />}
                                    Withdraw Earnings
                                </button>
                            </div>

                            {/* Usage Test Key */}
                            <div className="rounded-[28px] border border-black/10 bg-white p-6 space-y-4">
                                <div>
                                    <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#082824]">API Key for Testing</p>
                                    <p className="text-xs text-black/60 mt-1">
                                        Paste your secret API key here to test sending usage charges.
                                    </p>
                                </div>
                                <label className="block space-y-1.5">
                                    <span className="text-xs sm:text-sm font-bold text-[#082824]">Secret key</span>
                                    <input
                                        type="password"
                                        value={usageSecretKey}
                                        onChange={(e) => setUsageSecretKey(e.target.value)}
                                        autoComplete="off"
                                        className="w-full bg-[#FFFFF0] border border-black/15 rounded-2xl px-4 py-3 text-black focus:outline-none focus:border-[#8AB4DB] transition text-sm sm:text-base font-mono"
                                        placeholder="sk_test_..."
                                    />
                                </label>
                                <p className="text-xs text-black/50">
                                    Keys are only shown once when created. This test field is not saved to the server.
                                </p>
                            </div>
                        </div>

                        {vaultOpsStatus && (
                            <p className={`text-xs sm:text-sm font-bold tracking-wide ${
                                vaultOpsStatus.type === "success" ? "text-emerald-700" : "text-red-600"
                            }`}>
                                {vaultOpsStatus.text}
                            </p>
                        )}
                    </div>

                    {/* Customer Vaults list */}
                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 text-black space-y-6 shadow-sm">
                        <div>
                            <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2">Active Customer Deposits</h2>
                            <p className="text-sm sm:text-base text-black/70 font-sans leading-relaxed">
                                Live view of customer deposits and current usage. Rows are identified by
                                reference, or by the email a customer gave you at checkout — their wallet
                                stays private.
                            </p>
                        </div>

                        {isVaultsLoading ? (
                            <div className="space-y-3 animate-pulse">
                                {Array.from({ length: 2 }).map((_, i) => (
                                    <div key={i} className="rounded-2xl border border-black/10 bg-black/5 p-5 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <div className="h-5 w-36 rounded bg-black/15" />
                                            <div className="h-5 w-16 rounded bg-black/10" />
                                        </div>
                                        <div className="h-2.5 w-full rounded-full bg-black/10" />
                                        <div className="flex justify-between">
                                            <div className="h-4 w-20 rounded bg-black/10" />
                                            <div className="h-4 w-24 rounded bg-black/15" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : vaultsError ? (
                            <div className="flex h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-center p-4">
                                <p className="text-sm font-bold text-red-600">{vaultsError}</p>
                            </div>
                        ) : vaults.length === 0 ? (
                            <div className="flex h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-black/[0.02] text-center p-4">
                                <p className="text-sm text-black/60">No customer deposits yet. When customers deposit funds, they&apos;ll appear here.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-4">
                                    {vaults.map((vault) => (
                                        <LocalCustomerVaultRow
                                            key={vault.id}
                                            vault={vault}
                                            apiKey={usageSecretKey.trim() || selectedApiKey}
                                            onRefresh={fetchVaults}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        switch (activeTab) {
            case "offramp":
                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <ArrowRightLeft className={`w-5 h-5 ${primaryColorText}`} />
                                Fiat off-ramp
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Bank settlement routing is not yet available. No bank account is connected and changing controls here will never move or allocate funds.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-5 flex items-start gap-4">
                            <div className="p-2 rounded-xl flex-shrink-0 border bg-amber-400/10 border-amber-400/20 text-amber-300">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-white uppercase tracking-wider">Coming soon</p>
                                <p className="text-[10px] text-white/50 leading-relaxed font-sans">
                                    When this launches, you will review the verified bank destination, conversion quote, fees, settlement timing, and allocation before explicitly confirming any change.
                                </p>
                            </div>
                        </div>
                    </div>
                );

            case "settings":
                return renderSettingsTab();
 
             case "payment-links":
                return (
                    <div className="space-y-6" {...paymentSubTabsSwipe}>
                        <div className="flex items-center gap-2 border-b border-black/10 pb-3">
                            <button
                                type="button"
                                onClick={() => setSubTab("subscriptions")}
                                className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                                    subTab === "subscriptions"
                                        ? "bg-[#082824] text-white shadow-sm"
                                        : "bg-black/5 text-black/60 hover:bg-black/10"
                                }`}
                            >
                                Plans
                            </button>
                            <button
                                type="button"
                                onClick={() => setSubTab("one-time")}
                                className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                                    subTab === "one-time"
                                        ? "bg-[#082824] text-white shadow-sm"
                                        : "bg-black/5 text-black/60 hover:bg-black/10"
                                }`}
                            >
                                One-Time Links
                            </button>
                            {isPremium && (
                                <button
                                    type="button"
                                    onClick={() => setSubTab("commit")}
                                    className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                                        subTab === "commit"
                                            ? "bg-[#082824] text-white shadow-sm"
                                            : "bg-black/5 text-black/60 hover:bg-black/10"
                                    }`}
                                >
                                    Vault
                                </button>
                            )}
                        </div>
                        <motion.div
                            key={subTab}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="w-full"
                        >
                            {subTab === "subscriptions" && renderPlansTab()}
                            {subTab === "one-time" && renderPaymentLinksTab()}
                            {subTab === "commit" && renderCommitTab()}
                        </motion.div>
                    </div>
                );

            case "plans":
                return renderPlansTab();

            case "payroll":
                return <PayrollContent embedded />;

            case "overview":
                return (
                    <MerchantOverview
                        walletBalance={walletBalance}
                        vaultBalance={vaultBalance}
                        projected30DaySettlement={projected30DaySettlement}
                        ledgers={ledgers}
                        balanceVisible={balanceVisible}
                        isRefreshingBalances={isRefreshingBalances}
                        isLoadingContract={isLoadingContract}
                        theme={resolvedTheme}
                        onToggleBalance={() => setBalanceVisible((visible) => !visible)}
                        onRefresh={handleManualRefreshBalances}
                        onSend={() => setIsSendWalletOpen(true)}
                        onReceive={() => setIsDepositOpen(true)}
                        onDeposit={() => setIsDepositOpen(true)}
                        onWithdraw={() => setIsWithdrawOpen(true)}
                        onScanQr={() => setIsQrScannerOpen(true)}
                        onViewPlans={() => { setActiveTab("payment-links"); setSubTab("subscriptions"); }}
                    />
                );

            case "premium": {
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-sm text-black font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#082824]" />
                            <h2 className="text-lg font-semibold text-black">Verify Wallet Ownership</h2>
                            <p className="text-xs text-black/60 leading-relaxed max-w-xs mx-auto">
                                To manage premium subscriptions and security configurations, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-[#082824]" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                return (
                    <div className="space-y-8 text-black">
                        {/* Tier Status Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm">
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-2xl bg-amber-500/10 dark:bg-amber-400/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 dark:border-amber-400/30">
                                    <Crown className="w-8 h-8" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-xl font-bold text-[#082824] dark:text-white tracking-tight">
                                            {isPremium ? "Premium Active" : "Standard Tier"}
                                        </h2>
                                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                            isPremium 
                                                ? "bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300 border border-amber-500/20 dark:border-amber-400/30" 
                                                : "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60 border border-black/10 dark:border-white/10"
                                        }`}>
                                            Tier {merchantTier}
                                        </span>
                                    </div>
                                    <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed">
                                        {isPremium 
                                            ? "You have full access to payout rerouting, priority keeper execution, advanced analytics, and multi-wallet support." 
                                            : "Upgrade to Premium Pro to unlock payout rerouting, priority execution, advanced analytics, and more."
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>

                        {isPremium ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                                <div className="md:col-span-2 space-y-6">
                                    {/* PAST_DUE Warning Banner */}
                                    {dbSubscriptionStatus === "PAST_DUE" && (
                                        <div className="border border-amber-600/30 rounded-3xl p-6 shadow-sm space-y-4 bg-amber-50 text-amber-900">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-amber-100 border border-amber-300 text-amber-800 rounded-xl">
                                                    <AlertTriangle className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-bold uppercase tracking-wider">Premium Grace Period</h3>
                                                    <p className="text-xs text-amber-700">Payment failed. Access temporarily preserved.</p>
                                                </div>
                                            </div>
                                            <p className="text-xs text-amber-800 leading-relaxed font-sans">
                                                Your Premium renewal payment could not be processed. Premium access remains active during the grace period. Please restore wallet balance or allowance to avoid interruption.
                                            </p>
                                            <div className="grid grid-cols-2 gap-4 bg-white/80 border border-amber-200 rounded-2xl p-4">
                                                <div>
                                                    <p className="text-[10px] text-amber-700 uppercase font-bold tracking-widest leading-none mb-1">Billing Status</p>
                                                    <p className="text-xs font-semibold text-amber-900">Attempt {downgradeFailures} of 3</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-amber-700 uppercase font-bold tracking-widest leading-none mb-1">Grace Period</p>
                                                    <p className="text-xs font-semibold text-amber-900">{3 - downgradeFailures} {3 - downgradeFailures === 1 ? "day" : "days"} remaining</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Payout Rerouting Controls */}
                                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 shadow-sm space-y-6">
                                        <h3 className="text-sm font-semibold text-black flex items-center gap-2">
                                            <ArrowRightLeft className="w-4 h-4 text-[#082824]" />
                                            Fund Rerouting
                                        </h3>

                                        {/* Current Destination */}
                                        <div className="bg-[#D4E3E8]/40 border border-black/10 rounded-2xl p-5">
                                            <p className="text-[10px] text-black/50 uppercase font-bold tracking-widest mb-2">Current Payout Destination</p>
                                            {payoutDestination ? (
                                                <div className="flex items-center gap-3">
                                                    <code className="text-sm font-mono text-[#082824] break-all font-semibold">{payoutDestination}</code>
                                                    <button
                                                        onClick={() => handleCopy(payoutDestination, "Payout Destination")}
                                                        className="p-1.5 text-black/40 hover:text-black rounded-lg hover:bg-black/5 transition-all flex-shrink-0"
                                                    >
                                                        {copiedText === "Payout Destination" ? <Check className="w-3.5 h-3.5 text-[#082824]" /> : <Copy className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-black/60">Default: funds route to your connected wallet ({address?.slice(0, 6)}...{address?.slice(-4)})</p>
                                            )}
                                        </div>

                                        {/* Set New Destination */}
                                        <div>
                                            <label className="text-[10px] text-black/60 font-semibold uppercase tracking-widest block mb-2">
                                                New Destination Address
                                            </label>
                                            <div className="flex flex-col gap-3 sm:flex-row">
                                                <input
                                                    type="text"
                                                    value={rerouteAddress}
                                                    onChange={(e) => setRerouteAddress(e.target.value)}
                                                    placeholder="0x... cold storage, multisig, or ledger address"
                                                    className="min-w-0 w-full flex-1 bg-white border border-black/15 rounded-xl px-4 py-3 text-xs font-mono text-black focus:outline-none focus:border-[#8AB4DB] transition-colors placeholder:text-black/30"
                                                />
                                                <button
                                                    onClick={handleReroute}
                                                    disabled={isRerouting || !rerouteAddress}
                                                    className="w-full sm:w-auto shrink-0 px-6 py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] font-semibold rounded-full text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isRerouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                                                    Reroute
                                                </button>
                                            </div>
                                            {rerouteSuccess && (
                                                <p className="text-emerald-700 text-xs mt-3 font-semibold">Payout destination updated on-chain</p>
                                            )}
                                            {premiumError && (
                                                <p className="text-red-600 text-xs mt-3 font-mono break-all">{premiumError}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Arc Confidentiality & Governed Access settings card */}
                                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 shadow-sm space-y-6">
                                        <h3 className="text-sm font-semibold text-black flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-[#082824]" />
                                            Arc Confidentiality
                                        </h3>

                                        {/* Operational switch for Shielded Batch Payouts */}
                                        <div className="flex items-center justify-between bg-[#D4E3E8]/40 border border-black/10 rounded-2xl p-5">
                                            <div>
                                                <h4 className="text-xs font-semibold text-black mb-1">Confidential Batch Payouts <span className="text-black/50">(Preview)</span></h4>
                                                <p className="text-[10px] text-black/60 leading-normal max-w-md font-sans">
                                                    Masks recipient addresses and transfer amounts in SubScript&apos;s batch event log. Note: the underlying USDC transfers are still recorded on Arc&apos;s public ledger today &mdash; full on-chain shielding activates once Arc&apos;s Privacy Sector (APS) is live.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {!isPremium && <Lock className="w-3.5 h-3.5 text-black/40" />}
                                                <button
                                                    onClick={handleToggleShielded}
                                                    disabled={!isPremium}
                                                    className={`w-11 h-6 rounded-full p-1 transition-all duration-300 ${
                                                        !isPremium ? "opacity-50 cursor-not-allowed bg-black/10" : (shieldedEnabled ? "bg-[#8AB4DB]" : "bg-black/20")
                                                    }`}
                                                >
                                                    <div
                                                        className={`w-4 h-4 rounded-full bg-white transition-all duration-300 transform ${
                                                            shieldedEnabled && isPremium ? "translate-x-5" : "translate-x-0"
                                                        }`}
                                                    />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Governed Access panel containing a generation button for the View Key */}
                                        <div className="bg-[#D4E3E8]/40 border border-black/10 rounded-2xl p-5 space-y-4">
                                            <div>
                                                <h4 className="text-xs font-semibold text-black mb-1">Governed View Key</h4>
                                                <p className="text-[10px] text-black/60 leading-normal font-sans">
                                                    Generate and register a View Key. Its hash is stored on-chain and gates retrieval of your batch payout history. The key itself never leaves your browser; only its hash is registered.
                                                </p>
                                            </div>

                                            <div className="flex gap-3">
                                                <div className="relative flex-1">
                                                    <input
                                                        type={showViewKey ? "text" : "password"}
                                                        value={viewKey}
                                                        readOnly
                                                        disabled={!isPremium}
                                                        placeholder="Click generate to create a View Key"
                                                        className={`w-full bg-white border border-black/15 rounded-xl pl-4 pr-10 py-3 text-xs font-mono text-black focus:outline-none placeholder:text-black/30 ${
                                                            !isPremium ? "opacity-50 cursor-not-allowed" : ""
                                                        }`}
                                                    />
                                                    {viewKey && (
                                                        <button
                                                            onClick={() => setShowViewKey(!showViewKey)}
                                                            disabled={!isPremium}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {showViewKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                </div>
                                                
                                                {viewKey ? (
                                                    <button
                                                        onClick={handleCopyViewKey}
                                                        disabled={!isPremium}
                                                        className="px-4 bg-white border border-black/15 text-black rounded-xl hover:bg-black/5 transition-all flex items-center justify-center animate-none disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {copiedViewKey ? <Check className="w-4 h-4 text-[#082824]" /> : <Copy className="w-4 h-4" />}
                                                    </button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        {!isPremium && <Lock className="w-3.5 h-3.5 text-black/40" />}
                                                        <button
                                                            onClick={handleGenerateViewKey}
                                                            disabled={!isPremium}
                                                            className={`px-5 py-3 border text-xs font-semibold rounded-full transition-all flex items-center gap-2 ${
                                                                !isPremium 
                                                                    ? "bg-black/5 border-black/10 text-black/40 cursor-not-allowed" 
                                                                    : "bg-[#8AB4DB] text-[#082824] hover:bg-[#7aa7d0] border-transparent"
                                                            }`}
                                                        >
                                                            <Key className="w-3.5 h-3.5" />
                                                            Generate
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {viewKey && !isViewKeyRegistered && (
                                                <div className="flex items-center justify-between pt-2">
                                                    <span className="text-[10px] text-amber-800 font-semibold flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" /> Key generated but not registered on-chain
                                                    </span>
                                                    <button
                                                        onClick={handleSaveConfidentiality}
                                                        disabled={isSavingConfidentiality || !isPremium}
                                                        className={`px-5 py-2.5 font-semibold rounded-full text-xs transition-all flex items-center gap-2 ${
                                                            !isPremium 
                                                                ? "bg-black/5 border border-black/10 text-black/40 cursor-not-allowed" 
                                                                : "bg-[#8AB4DB] text-[#082824] hover:bg-[#7aa7d0]"
                                                        }`}
                                                    >
                                                        {isSavingConfidentiality ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                        Register Key
                                                    </button>
                                                </div>
                                            )}

                                            {isViewKeyRegistered && (
                                                <div className="flex items-center justify-between pt-2">
                                                    <span className="text-[10px] text-emerald-800 font-semibold flex items-center gap-1">
                                                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> View Key is active and registered
                                                    </span>
                                                    <button
                                                        onClick={handleSaveConfidentiality}
                                                        disabled={isSavingConfidentiality || !isPremium}
                                                        className={`px-4 py-2 font-semibold rounded-full text-xs transition-all flex items-center gap-2 ${
                                                            !isPremium 
                                                                ? "bg-black/5 border border-black/10 text-black/40 cursor-not-allowed" 
                                                                : "bg-white border border-black/15 hover:bg-black/5 text-black"
                                                        }`}
                                                    >
                                                        {isSavingConfidentiality ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                                        Update Settings
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Manual Keeper Execution Control */}
                                    <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 shadow-sm space-y-6">
                                        <h3 className="text-sm font-semibold text-[#082824] dark:text-white flex items-center gap-2">
                                            <PlugZap className="w-4 h-4 text-[#082824] dark:text-emerald-400" />
                                            Keeper Force Execution
                                        </h3>
                                        <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                                            Force the SubScript protocol keepers to check and execute any due subscription payments for your wallet immediately on-chain, bypassing the standard scheduler loop.
                                        </p>
                                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-[#D4E3E8]/40 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-2xl p-5">
                                            <div>
                                                <p className="text-[10px] text-black/50 dark:text-white/50 uppercase font-bold tracking-widest leading-none mb-1">Status</p>
                                                <p className="text-xs font-semibold text-black/80 dark:text-white/80">Schedule: Idle (60s cycles)</p>
                                            </div>
                                            <button
                                                onClick={handleTriggerKeeper}
                                                disabled={isTriggeringKeeper}
                                                className="px-6 py-3 bg-[#8AB4DB] text-[#082824] font-semibold rounded-full text-xs hover:bg-[#7aa7d0] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                {isTriggeringKeeper ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                                Run Keepers
                                            </button>
                                        </div>
                                        {keeperStatus && (
                                            <p className="text-emerald-700 dark:text-emerald-400 text-xs font-semibold">{keeperStatus}</p>
                                        )}
                                        {keeperError && (
                                            <p className="text-red-600 dark:text-red-400 text-xs font-mono break-all">{keeperError}</p>
                                        )}
                                    </div>

                                    {/* Subscription Cancellation Control */}
                                    <div className={`rounded-[34px] border p-6 shadow-sm space-y-6 ${
                                        cancelAtPeriodEnd 
                                            ? "border-amber-500/30 bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" 
                                            : "border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023]"
                                    }`}>
                                        <h3 className={`text-sm font-semibold flex items-center gap-2 ${
                                            cancelAtPeriodEnd ? "text-amber-700 dark:text-amber-300" : "text-[#082824] dark:text-white"
                                        }`}>
                                            <ShieldAlert className={`w-4 h-4 ${cancelAtPeriodEnd ? "text-amber-600 dark:text-amber-400" : "text-black/60 dark:text-white/60"}`} />
                                            {cancelAtPeriodEnd ? "Subscription Scheduled to End" : "Subscription Management"}
                                        </h3>
                                        <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                                            {cancelAtPeriodEnd 
                                                ? `Your Premium subscription will remain active until ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "the end of the current period"}. You can resume anytime before that date.`
                                                : "Cancel your active SubScript Premium subscription. Your Premium benefits will remain active until the end of your current billing period."
                                            }
                                        </p>
                                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-2xl p-5">
                                            <div>
                                                <p className="text-[10px] text-black/50 dark:text-white/50 uppercase font-bold tracking-widest leading-none mb-1">Billing Status</p>
                                                <p className="text-xs font-semibold text-[#082824] dark:text-white flex items-center gap-1.5">
                                                    {!cancelAtPeriodEnd && <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block shrink-0" />}
                                                    {cancelAtPeriodEnd ? "Pending Cancellation" : "Active (Renews monthly)"}
                                                </p>
                                            </div>
                                            {cancelAtPeriodEnd ? (
                                                <button
                                                    onClick={handleResumePremium}
                                                    disabled={isResumingPremium || !isPremium}
                                                    className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-full text-xs hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isResumingPremium ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                                    Resume Premium
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleCancelPremium}
                                                    disabled={isCancellingPremium || !isPremium}
                                                    className="px-5 py-2.5 border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-500/15 rounded-full text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isCancellingPremium ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                                    Cancel Premium Pro
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Premium Features Summary */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        {[
                                            { icon: ArrowRightLeft, title: "Fund Rerouting", desc: "Route subscription funds to cold storage, multisig, or custom wallets.", active: true },
                                            { icon: Activity, title: "Priority Execution", desc: "Keeper bots prioritize your subscription renewals in the execution queue.", active: true },
                                            { icon: Webhook, title: "Advanced Webhooks", desc: "Full webhook event stream with payload inspection and replay capability.", active: true },
                                            { icon: Key, title: "Full API Access", desc: "Publishable and secret API keys for backend SDK integration.", active: true },
                                        ].map((feature, idx) => (
                                            <div key={idx} className="rounded-2xl border border-black/10 dark:border-white/10 bg-[#D4E3E8]/40 dark:bg-white/[0.04] p-5 flex items-start gap-3">
                                                <div className="p-2 bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/20 dark:border-amber-400/30 text-amber-700 dark:text-amber-300 rounded-xl flex-shrink-0">
                                                    <feature.icon className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold text-black dark:text-white mb-0.5">{feature.title}</p>
                                                    <p className="text-[10px] text-black/60 dark:text-white/60 leading-relaxed font-sans">{feature.desc}</p>
                                                </div>
                                                <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-500/20 dark:border-emerald-500/30 flex-shrink-0">Active</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="md:col-span-1 space-y-6">
                                    {/* Billing Summary Card */}
                                    <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 text-black dark:text-white space-y-4 shadow-sm">
                                        <h4 className="text-[10px] text-black/50 dark:text-white/50 uppercase font-semibold tracking-widest text-center">Subscription Billing</h4>
                                        <div className="space-y-3 font-mono text-[10px] text-black/70 dark:text-white/70">
                                            <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                                                <span>Tier:</span>
                                                <span className="text-amber-700 dark:text-amber-300 font-bold">PREMIUM PRO</span>
                                            </div>
                                            <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                                                <span>Price:</span>
                                                <span>$10 / mo</span>
                                            </div>
                                            {currentPeriodEnd && (
                                                <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                                                    <span>{cancelAtPeriodEnd ? "Expires:" : "Next Renewal:"}</span>
                                                    <span>{new Date(currentPeriodEnd).toLocaleDateString()}</span>
                                                </div>
                                            )}
                                        </div>
                                        <Link
                                            href="/merchant/upgrade"
                                            className="w-full py-3 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] font-semibold rounded-full text-xs transition-all flex items-center justify-center gap-2 text-center"
                                        >
                                            Manage Subscription
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Upgrade CTA for Standard tier */
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black shadow-sm">
                                <div className="max-w-lg mx-auto text-center space-y-6">
                                    <div className="space-y-2">
                                        <h3 className="text-lg font-semibold text-black">Upgrade to Premium Pro</h3>
                                        <p className="text-xs text-black/60 leading-relaxed font-sans">
                                            Unlock payout rerouting to cold storage and multisigs, priority keeper execution, real-time analytics, and full API/webhook access.
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-center gap-2">
                                        <span className="text-3xl font-bold text-[#082824]">$10</span>
                                        <span className="text-xs text-black/50">/ month</span>
                                    </div>

                                    <Link
                                        href="/merchant/upgrade"
                                        className="px-8 py-3.5 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] font-semibold text-xs rounded-full transition-all flex items-center gap-2 mx-auto w-fit"
                                    >
                                        <Crown className="w-4 h-4" /> View Upgrade Options
                                    </Link>

                                    {/* Features list */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-4 border-t border-black/10">
                                        {[
                                            "Opt-In Privacy Controls",
                                            "Priority keeper execution",
                                            "Advanced analytics",
                                            "Full API & webhook access",
                                            "Multi-wallet support",
                                            "Premium Pro merchant badge"
                                        ].map((f, i) => (
                                            <div key={i} className="flex items-center gap-2 text-xs text-black/70 font-sans">
                                                <Check className="w-3.5 h-3.5 text-[#082824] flex-shrink-0" /> {f}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Quick Jump Developer Portal & Merchant Operations */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                            {/* Merchant KYC / Verification Status */}
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 shadow-sm space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-semibold text-[#082824] dark:text-white flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-[#082824] dark:text-emerald-400" /> Business Verification
                                    </h4>
                                    {userSettings.verified ? (
                                        <span className="px-2.5 py-1 text-[9px] font-bold rounded-full bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-500/20 dark:border-emerald-500/30">Verified</span>
                                    ) : (
                                        <span className="px-2.5 py-1 text-[9px] font-bold rounded-full bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300 border border-amber-500/20 dark:border-amber-400/30">Unverified</span>
                                    )}
                                </div>
                                <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                                    {userSettings.verified
                                        ? "Your merchant account is verified. Checkout links will display a verified trust badge to customers."
                                        : "Complete business verification to gain verified status and remove checkout warnings."}
                                </p>
                            </div>

                            {/* Developer Portal Quick Jump */}
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 shadow-sm space-y-4">
                                <h4 className="text-xs font-semibold text-[#082824] dark:text-white flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-[#082824] dark:text-sky-400" /> Developer Quick-Jump
                                </h4>
                                <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">Access backend API keys, webhooks outbox, and SDK documentation.</p>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setActiveTab("apikeys")}
                                        className="flex-1 py-2.5 bg-[#8AB4DB] hover:bg-[#7aa7d0] text-[#082824] rounded-full text-xs font-semibold transition flex items-center justify-center gap-1.5"
                                    >
                                        <Key className="w-3.5 h-3.5" /> API Keys
                                    </button>
                                    <button
                                        onClick={() => setActiveTab("webhooks")}
                                        className="flex-1 py-2.5 bg-white dark:bg-white/10 border border-black/15 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/15 text-black dark:text-white rounded-full text-xs font-semibold transition flex items-center justify-center gap-1.5"
                                    >
                                        <Webhook className="w-3.5 h-3.5 text-[#082824] dark:text-white" /> Webhooks
                                    </button>
                                </div>
                            </div>

                            {/* Notification Preferences */}
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 shadow-sm space-y-4">
                                <h4 className="text-xs font-semibold text-[#082824] dark:text-white flex items-center gap-2">
                                    <Bell className="w-4 h-4 text-[#082824] dark:text-amber-400" /> Notification Toggles
                                </h4>
                                <div className="space-y-2 text-xs text-black/70 dark:text-white/70 font-sans">
                                    <label className="flex items-center justify-between p-2 rounded-xl bg-[#D4E3E8]/40 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 cursor-pointer">
                                        <span>New Subscriptions</span>
                                        <input type="checkbox" defaultChecked className="accent-[#082824] dark:accent-[#00d2b4] w-4 h-4" />
                                    </label>
                                    <label className="flex items-center justify-between p-2 rounded-xl bg-[#D4E3E8]/40 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 cursor-pointer">
                                        <span>Successful Payments</span>
                                        <input type="checkbox" defaultChecked className="accent-[#082824] dark:accent-[#00d2b4] w-4 h-4" />
                                    </label>
                                    <label className="flex items-center justify-between p-2 rounded-xl bg-[#D4E3E8]/40 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 cursor-pointer">
                                        <span>Failed Renewals</span>
                                        <input type="checkbox" defaultChecked className="accent-[#082824] dark:accent-[#00d2b4] w-4 h-4" />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            }

            case "apikeys": {
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-sm text-black font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#082824]" />
                            <h2 className="text-xl font-bold text-[#082824]">Verify Wallet Ownership</h2>
                            <p className="text-xs sm:text-sm text-black/60 leading-relaxed max-w-xs mx-auto">
                                To protect your API credentials and webhook endpoints, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3.5 bg-[#000000] hover:bg-black/85 text-white rounded-full text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                const activeKey = apiKeys.find(k => !k.revoked) || null;
                const activePublishableKey = activeKey ? activeKey.publishableKey : "";
                const activeSecretKey = activeKey ? activeKey.secretKeyPlain : "";
                const activeSecretAvailable = Boolean(activeKey?.secretKeyAvailable && activeSecretKey);

                return (
                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black space-y-8 shadow-sm font-sans">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2 flex items-center gap-2.5">
                                    <Key className="w-5 h-5 text-[#082824]" />
                                    API Credentials
                                </h2>
                                <p className="text-sm sm:text-base text-black/70 font-sans leading-relaxed">
                                    Use these keys to authenticate your backend with the SubScript SDK.
                                    API credentials are secure and persisted in the database.
                                </p>
                            </div>
                            {sessionWallet && (
                                <button
                                    onClick={handleLogout}
                                    className="px-4 py-2 border border-black/15 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/20 rounded-full text-xs font-bold font-sans transition-all shrink-0"
                                >
                                    Log Out Developer Portal
                                </button>
                            )}
                        </div>

                        {apiKeySetupStatus && (
                            <p role="status" className="rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-xs sm:text-sm leading-relaxed text-black/70 font-sans">
                                {apiKeySetupStatus}
                            </p>
                        )}

                        {isKeysLoading ? (
                            <div className="space-y-6 font-sans">
                                <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 space-y-3 subscript-skeleton">
                                    <div className="h-4 w-32 rounded-full bg-[#082824]/20" />
                                    <div className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 space-y-3 subscript-skeleton">
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-24 rounded-full bg-[#082824]/20" />
                                        <div className="h-5 w-14 rounded-full bg-yellow-500/20" />
                                    </div>
                                    <div className="h-12 w-full rounded-2xl bg-white" />
                                    <div className="h-3.5 w-72 rounded-full bg-black/10" />
                                </div>
                            </div>
                        ) : !activeKey ? (
                            <div className="border border-black/10 rounded-3xl p-6 sm:p-8 text-center bg-black/[0.02] space-y-5 font-sans">
                                <Key className="w-10 h-10 mx-auto text-[#082824]/40" />
                                <div className="space-y-1">
                                    <p className="text-base sm:text-lg font-bold text-[#082824]">No Active API Credentials</p>
                                    <p className="text-xs sm:text-sm text-black/60 leading-relaxed max-w-md mx-auto">
                                        Generate credentials and optionally register the webhook receiver that belongs to this integration.
                                    </p>
                                </div>
                                <div className="mx-auto w-full max-w-xl space-y-2 text-left">
                                    <label htmlFor="api-key-webhook-url" className="block text-xs sm:text-sm font-bold text-[#082824]">
                                        Webhook URL <span className="font-normal normal-case text-black/50">(recommended)</span>
                                    </label>
                                    <input
                                        id="api-key-webhook-url"
                                        type="url"
                                        value={apiKeyWebhookUrl}
                                        onChange={(event) => setApiKeyWebhookUrl(event.target.value)}
                                        placeholder="https://your-app.example/api/subscript/webhook"
                                        className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-sm sm:text-base text-black outline-none transition-colors focus:border-[#8AB4DB]"
                                    />
                                    <p className="text-xs leading-relaxed text-black/50">
                                        SubScript creates the endpoint with your API key so payment and subscription events are observable immediately.
                                    </p>
                                </div>
                                <button
                                    onClick={handleRollKeys}
                                    disabled={isRolling}
                                    className="px-8 py-3.5 bg-[#000000] hover:bg-black/85 text-white rounded-full text-sm sm:text-base font-bold flex items-center gap-2 mx-auto transition-all shadow-sm disabled:opacity-50"
                                >
                                    {isRolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                                    Generate API Keys
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Publishable Key */}
                                <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 font-sans space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs sm:text-sm text-[#082824] font-bold uppercase tracking-wider font-mono">Publishable Key</span>
                                        {copiedText === "Publishable Key" && (
                                            <span className="text-xs text-[#082824] font-bold">Copied!</span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between gap-4 bg-white rounded-2xl p-4 border border-black/10">
                                        <code className="text-xs sm:text-sm font-mono text-black/90 break-all select-all font-semibold">{activePublishableKey}</code>
                                        <button 
                                            onClick={() => handleCopy(activePublishableKey, "Publishable Key")}
                                            className="p-2.5 text-black/60 hover:text-black rounded-xl hover:bg-black/5 transition-all"
                                            title="Copy Publishable Key"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Secret Key */}
                                <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 font-sans space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs sm:text-sm text-[#082824] font-bold uppercase tracking-wider font-mono">Secret Key</span>
                                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 border border-yellow-500/30">Secret</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {copiedText === "Secret Key" && (
                                                <span className="text-xs text-[#082824] font-bold">Copied!</span>
                                            )}
                                            {activeSecretAvailable && (
                                                <button
                                                    onClick={() => setRevealSecret(!revealSecret)}
                                                    className="text-black/60 hover:text-black transition-colors"
                                                    title={revealSecret ? "Hide secret" : "Reveal secret"}
                                                >
                                                    {revealSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {activeSecretAvailable ? (
                                        <>
                                            <div className="flex items-center justify-between gap-4 bg-white rounded-2xl p-4 border border-black/10 font-mono">
                                                <code className="text-xs sm:text-sm text-black/90 break-all font-semibold">
                                                    {revealSecret
                                                        ? activeSecretKey
                                                        : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                                                    }
                                                </code>
                                                <button
                                                    onClick={() => handleCopy(activeSecretKey, "Secret Key")}
                                                    disabled={!revealSecret}
                                                    className="p-2.5 text-black/60 hover:text-black hover:bg-black/5 rounded-xl disabled:opacity-30 disabled:pointer-events-none transition-all"
                                                    title="Copy Secret Key"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs sm:text-sm leading-relaxed text-amber-900">
                                                Copy this now. It is only readable while this page stays open; the key is stored
                                                hashed, so it cannot be shown again.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-4 rounded-2xl border border-black/10 bg-white p-4 font-mono">
                                                <code className="break-all text-xs sm:text-sm text-black/70 font-semibold">{activeSecretKey}</code>
                                            </div>
                                            <p className="text-xs sm:text-sm leading-relaxed text-black/60">
                                                This is a fingerprint of the live key, not the key itself. It's enough to tell which one
                                                your integration should be using. The secret is stored hashed and is shown only once,
                                                when it is created. If you no longer have it, roll the key below to issue a new one.
                                            </p>
                                        </>
                                    )}
                                </div>

                                {/* Roll Keys */}
                                <div className="pt-6 border-t border-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-sans">
                                    <div>
                                        <h3 className="text-sm sm:text-base font-bold text-[#082824] mb-1">Rotation / Roll Credentials</h3>
                                        <p className="text-xs sm:text-sm text-black/60 max-w-md">
                                            Roll your API key pair instantly. Old keys are immediately invalidated for safety in this sandbox.
                                            {!activeSecretAvailable && " This is also how you get a readable secret if you no longer have the current one. The new key is revealed and copied once, here."}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        {copiedText === "API Secret Key Rolled" && (
                                            <span className="text-xs text-[#082824] font-bold">API Secret Key Rolled</span>
                                        )}
                                        <button
                                            onClick={handleRollKeys}
                                            disabled={isRolling}
                                            className={`px-6 py-2.5 border border-black/15 bg-white rounded-full text-xs sm:text-sm font-bold text-[#082824] hover:bg-black/5 transition-all flex items-center gap-2 shadow-sm ${isRolling ? "opacity-50" : ""}`}
                                        >
                                            {isRolling ? <RefreshCw className="w-4 h-4 animate-spin text-black" /> : <RotateCw className="w-4 h-4 text-black" />}
                                            Roll
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            }

            case "checkout":
                return (
                    <div className="space-y-8 font-sans">
                        {/* Fastest path: the CLI (no SDK, plain REST). */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-[#082824] flex items-center gap-2.5">
                                        <Code2 className="w-5 h-5 text-[#082824]" />
                                        Fastest integration: the CLI
                                    </h2>
                                    <p className="mt-1.5 text-xs sm:text-sm text-black/70 leading-relaxed max-w-md font-sans">
                                        One command scaffolds a checkout intent route, a signed webhook receiver, and a checkout button. SubScript is a plain REST API. There is no SDK to install.
                                    </p>
                                </div>
                                <a
                                    href="https://www.subscriptonarc.com/docs"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-xs sm:text-sm font-bold text-[#082824] hover:underline"
                                >
                                    Read the docs →
                                </a>
                            </div>
                            <div className="flex items-center gap-3 bg-[#D4E3E8]/60 border border-black/10 rounded-2xl px-5 py-3.5">
                                <code className="flex-1 text-xs sm:text-sm font-mono text-[#082824] font-bold break-all">npx @subscriptonarc/cli</code>
                                <button
                                    onClick={() => handleCopy("npx @subscriptonarc/cli", "CLI Command")}
                                    className="shrink-0 p-2 text-black/60 hover:text-black rounded-xl hover:bg-black/5 transition-colors"
                                    title="Copy command"
                                >
                                    {copiedText === "CLI Command" ? <Check className="w-4 h-4 text-[#082824]" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                            {/* Configurator Form */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black flex flex-col justify-between shadow-sm">
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-[#082824] mb-6 flex items-center gap-2.5">
                                        <Sliders className="w-5 h-5 text-[#082824]" />
                                        Checkout Configurator
                                    </h2>
                                    <div className="space-y-4 font-sans text-xs sm:text-sm">
                                        <div>
                                            <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Subscription/Plan Name</label>
                                            <input 
                                                type="text" 
                                                aria-label="Subscription/Plan Name"
                                                value={subName} 
                                                onChange={(e) => setSubName(e.target.value)}
                                                className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Monthly cap (USDC)</label>
                                                <input 
                                                    type="text" 
                                                    value={subCap} 
                                                    onChange={(e) => setSubCap(e.target.value)}
                                                    className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Billing Interval</label>
                                                <select 
                                                    value={subInterval}
                                                    onChange={(e) => setSubInterval(e.target.value)}
                                                    className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors appearance-none"
                                                >
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                    <option value="yearly">Yearly</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowCheckoutAdvanced(!showCheckoutAdvanced)}
                                                className="text-xs sm:text-sm text-black/70 hover:text-black flex items-center gap-1.5 font-bold transition-colors"
                                            >
                                                <Sliders className="w-4 h-4" />
                                                {showCheckoutAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
                                            </button>
                                        </div>

                                        {showCheckoutAdvanced && (
                                            <div className="pt-4 border-t border-black/10 space-y-4">
                                                <div>
                                                    <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Settlement Rail</label>
                                                    <select 
                                                        value={subChain}
                                                        onChange={(e) => setSubChain(e.target.value)}
                                                        className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors font-sans"
                                                    >
                                                        <option value="arc">Arc Network (Hosted checkout live)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Wallet Connection Provider</label>
                                                    <select 
                                                        value={walletProvider}
                                                        onChange={(e) => setWalletProvider(e.target.value)}
                                                        className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors font-sans"
                                                    >
                                                        <option value="none">Not Connected (Agent will configure RainbowKit/wagmi)</option>
                                                        <option value="privy">Privy Auth (Embedded Wallets + Social Login)</option>
                                                        <option value="rainbowkit">RainbowKit (Standard Web3 Wallet Modal)</option>
                                                        <option value="web3onboard">Web3-Onboard (Enterprise Connection Modal)</option>
                                                        <option value="wagmi">wagmi Connectors (Custom wallet connect buttons)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Backend & Database Provider</label>
                                                    <select 
                                                        value={dbProvider}
                                                        onChange={(e) => setDbProvider(e.target.value)}
                                                        className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors font-sans"
                                                    >
                                                        <option value="none">No Database (Agent will auto-detect or recommend Prisma)</option>
                                                        <option value="prisma">Prisma ORM (PostgreSQL/MySQL/SQLite)</option>
                                                        <option value="supabase">Supabase (PostgreSQL with client SDK)</option>
                                                        <option value="mongodb">MongoDB / Mongoose (NoSQL)</option>
                                                        <option value="postgresql">PostgreSQL (Raw pg client pool)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs sm:text-sm font-bold text-[#082824] block mb-1.5">Session Persistence</label>
                                                    <select 
                                                        value={sessionProvider}
                                                        onChange={(e) => setSessionProvider(e.target.value)}
                                                        className="w-full bg-white border border-black/15 rounded-2xl px-4 py-3 text-black text-sm sm:text-base focus:outline-none focus:border-[#8AB4DB] transition-colors font-sans"
                                                    >
                                                        <option value="none">No Session Engine (Agent will configure HTTP Cookies/JWT)</option>
                                                        <option value="cookies">HTTP-Only Secure Cookies (Stateful session)</option>
                                                        <option value="jwt">JWT Tokens (Stateless Authorization Headers)</option>
                                                        <option value="privy">Privy User Sessions (Managed JWT / Access Token)</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-8 pt-4 border-t border-black/10 text-xs text-black/50 font-sans">
                                    SubScript is fast, private, and reliable: Arc-native USDC gas, private burner activation, and a 1% protocol fee.
                                </div>
                            </div>

                            {/* Code output Block */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black flex flex-col justify-between space-y-4 shadow-sm">
                                <div className="space-y-1">
                                    <h3 className="text-sm sm:text-base font-bold text-[#082824]">Checkout Snippet (REST · no SDK)</h3>
                                    <p className="text-xs text-black/60 font-sans">A fetch-based checkout button + intent route. No SDK to install.</p>
                                </div>
                                <pre className="bg-[#D4E3E8]/40 p-4 rounded-2xl border border-black/10 overflow-x-auto text-xs font-mono text-[#082824] text-left flex-1">
                                    <code>{checkoutCode}</code>
                                </pre>
                                <button 
                                    onClick={() => handleCopy(checkoutCode, "Checkout Snippet")}
                                    className="w-full py-3.5 rounded-full font-bold text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2 bg-[#000000] hover:bg-black/85 text-white shadow-sm"
                                >
                                    {copiedText === "Checkout Snippet" ? (
                                        <>
                                            <Check className="w-4 h-4" /> Snippet Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" /> Copy Checkout Component
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Agent Prompt Block */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] text-black overflow-hidden shadow-sm">
                            <div className="border-b border-black/10 px-6 sm:px-8 py-5 bg-black/[0.01]">
                                <h3 className="text-sm sm:text-base font-bold text-[#082824]">Agent Integration Prompt</h3>
                                <p className="text-xs text-black/60 font-sans mt-0.5">Set up your subscription options and grab the integration prompt for your AI agent.</p>
                            </div>
                            <div className="p-6 sm:p-8 space-y-5 font-sans">
                                {/* Configuration Status Card */}
                                <div className="bg-[#D4E3E8]/40 border border-black/10 rounded-2xl p-5 text-center">
                                    <p className="text-xs sm:text-sm text-black/75 leading-relaxed font-sans">
                                        Prompt configurations compiled successfully. Ready to copy for your AI coding assistant.
                                    </p>
                                </div>

                                <button
                                    onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                    className="w-full py-3.5 rounded-full font-bold text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2 bg-[#000000] hover:bg-black/85 text-white shadow-sm"
                                >
                                    {copiedText === "Agent Prompt" ? (
                                        <>
                                            <Check className="w-4 h-4" /> Prompt Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" /> Copy Payment Prompt
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* MCP Config */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black space-y-4 shadow-sm">
                            <div className="space-y-1">
                                <h3 className="text-sm sm:text-base font-bold text-[#082824]">cursor_mcp.json</h3>
                                <p className="text-xs text-black/60 font-sans mt-0.5">Drop-in MCP context for Cursor or compatible agents.</p>
                            </div>
                            <div className="bg-[#D4E3E8]/40 border border-black/10 rounded-2xl p-5 text-center">
                                <p className="text-xs sm:text-sm text-black/75 leading-relaxed font-sans">
                                    Cursor MCP Server configurations compiled successfully. Ready to deploy.
                                </p>
                            </div>
                            <button
                                onClick={() => handleCopy(cursorMcpConfig, "MCP Config")}
                                className="w-full py-3.5 rounded-full font-bold text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2 bg-[#000000] hover:bg-black/85 text-white shadow-sm"
                            >
                                {copiedText === "MCP Config" ? (
                                    <>
                                        <Check className="w-4 h-4" /> MCP Config Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" /> Copy MCP Configuration
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                );

            case "webhooks": {
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-sm text-black font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#082824]" />
                            <h2 className="text-xl font-bold text-[#082824]">Verify Wallet Ownership</h2>
                            <p className="text-xs sm:text-sm text-black/60 leading-relaxed max-w-xs mx-auto">
                                To protect your API credentials and webhook endpoints, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3.5 bg-[#000000] hover:bg-black/85 text-white rounded-full text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                const selectedPayload = webhookEvents.find(w => w.id === selectedWebhook);
                const webhookActiveKey = apiKeys.find((key) => !key.revoked) || null;
                const webhookKeyFingerprint = formatApiKeyFingerprint(webhookActiveKey?.secretKeyPlain)
                    || webhookActiveKey?.publishableKey
                    || "No active API key";

                return (
                    <div className="space-y-8 text-black font-sans">
                        {/* Webhook Endpoints Config */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-6">
                            <div>
                                <h2 className="text-xl font-bold sm:text-2xl text-[#082824] mb-2 flex items-center gap-2.5">
                                    <Sliders className="w-5 h-5 text-[#082824]" />
                                    Webhook Endpoints
                                </h2>
                                <p className="text-sm sm:text-base text-black/70 font-sans">
                                    Register HTTPS URLs to receive real-time webhook events for your subscription lifecycle.
                                </p>
                            </div>

                            <div className="grid gap-3 rounded-[28px] border border-black/10 bg-[#D4E3E8]/50 p-5 text-xs sm:text-sm font-sans sm:grid-cols-2">
                                <div>
                                    <p className="font-bold text-[#082824]/70">Merchant wallet</p>
                                    <p className="mt-1 break-all font-mono text-black font-semibold">{sessionWallet || "Not authenticated"}</p>
                                </div>
                                <div>
                                    <p className="font-bold text-[#082824]/70">API key</p>
                                    <p className="mt-1 break-all font-mono text-black font-semibold">{webhookKeyFingerprint}</p>
                                </div>
                            </div>

                            {/* Add endpoint form */}
                            <form onSubmit={handleAddWebhook} className="space-y-3 font-sans">
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <input
                                        type="url"
                                        value={webhookUrlInput}
                                        onChange={(e) => setWebhookUrlInput(e.target.value)}
                                        placeholder="https://your-api.com/webhooks/subscript"
                                        required
                                        className="flex-1 rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-sm sm:text-base text-black outline-none transition-colors focus:border-[#8AB4DB]"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isAddingWebhook || !webhookUrlInput}
                                        className="px-8 py-3.5 bg-[#000000] hover:bg-black/85 text-white rounded-full text-sm sm:text-base font-bold flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-40 shrink-0"
                                    >
                                        {isAddingWebhook ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <PlugZap className="w-4 h-4" />}
                                        Add Endpoint
                                    </button>
                                </div>
                            </form>

                            {/* Registered Endpoints List */}
                            <div className="space-y-3 pt-2">
                                <span className="text-xs sm:text-sm font-bold text-[#082824] uppercase tracking-wider font-mono">Registered Endpoints</span>
                                {isWebhooksLoading ? (
                                    <div className="space-y-3">
                                        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-2 subscript-skeleton">
                                            <div className="h-4 w-48 rounded-full bg-[#082824]/20" />
                                            <div className="h-3.5 w-64 rounded-full bg-black/10" />
                                        </div>
                                        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-2 subscript-skeleton">
                                            <div className="h-4 w-52 rounded-full bg-[#082824]/20" />
                                            <div className="h-3.5 w-60 rounded-full bg-black/10" />
                                        </div>
                                    </div>
                                ) : webhookEndpoints.length === 0 ? (
                                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-8 text-center text-sm text-black/60">
                                        No webhook endpoints registered yet. Add one above to begin receiving events.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {webhookEndpoints.map((ep) => (
                                            <div key={ep.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                                                <div className="space-y-1.5 min-w-0 flex-1 font-sans">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-sm sm:text-base font-bold text-[#082824] truncate">{ep.url}</span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-black/70">
                                                        <span className="font-bold">Secret: </span>
                                                        <code className="font-mono bg-[#D4E3E8]/40 px-2.5 py-1 rounded-lg border border-black/10">
                                                             {ep.secretAvailable && revealWebhookSecret === ep.id
                                                                ? ep.secret
                                                                : "whsec_••••••••"}
                                                        </code>
                                                        {ep.secretAvailable && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setRevealWebhookSecret(prev => prev === ep.id ? null : ep.id)}
                                                                    className="text-[#082824] font-bold hover:underline"
                                                                >
                                                                    {revealWebhookSecret === ep.id ? "Hide" : "Reveal"}
                                                                </button>
                                                                {revealWebhookSecret === ep.id && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCopy(ep.secret, `Webhook Secret ${ep.id}`)}
                                                                        className="inline-flex items-center gap-1 text-[#082824] hover:underline font-bold"
                                                                    >
                                                                        {copiedText === `Webhook Secret ${ep.id}` ? (
                                                                            <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Copied!</span>
                                                                        ) : (
                                                                            <>
                                                                                <Copy className="w-3.5 h-3.5" /> Copy secret
                                                                            </>
                                                                        )}
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-black/60 font-mono">
                                                        {ep.latestDelivery
                                                            ? <>Last delivery: <span className="font-mono font-bold text-black">{ep.latestDelivery.event}</span> · HTTP {ep.latestDelivery.status ?? "pending"} · {ep.latestDelivery.lastAttemptAt ? new Date(ep.latestDelivery.lastAttemptAt).toLocaleString() : "time unavailable"}</>
                                                            : (ep.deliveriesCount ? `${ep.deliveriesCount} deliveries` : "No deliveries recorded for this endpoint yet.")}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteWebhook(ep.id)}
                                                        className="px-4 py-2 rounded-full border border-red-200 bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30 dark:hover:bg-red-500/20 transition shadow-sm"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Webhook health checks */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-4">
                            <div>
                                <h2 className="text-lg sm:text-xl font-bold text-[#082824]">Webhook health checks</h2>
                                <p className="mt-1 text-xs sm:text-sm text-black/70 font-sans">
                                    Send signed sample events to every active endpoint, or resend the newest real delivery.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2.5">
                                {([
                                    ["test", "Send test webhook"],
                                    ["payment.succeeded", "Send test payment.succeeded"],
                                    ["subscription.created", "Send test subscription.created"],
                                ] as const).map(([eventType, label]) => (
                                    <button
                                        key={eventType}
                                        type="button"
                                        onClick={() => handleSendWebhookTest(eventType)}
                                        disabled={Boolean(isTestingWebhook) || webhookEndpoints.every((endpoint) => !endpoint.active)}
                                        className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-[#082824] hover:bg-black/5 transition disabled:opacity-40 shadow-sm"
                                    >
                                        {isTestingWebhook === eventType ? "Sending…" : label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => handleReplayWebhook()}
                                    disabled={isReplaying || webhookEvents.length === 0}
                                    className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-[#082824] hover:bg-black/5 transition disabled:opacity-40 shadow-sm"
                                >
                                    {isReplaying ? "Resending…" : "Resend latest event"}
                                </button>
                            </div>
                            {replayStatus && (
                                <p className="rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-xs sm:text-sm text-black/70 font-sans">{replayStatus}</p>
                            )}
                        </div>

                        {/* Event Feed and Inspector */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                            {/* Event Feed */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm flex flex-col justify-between">
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-[#082824] mb-5 flex items-center gap-2.5">
                                        <Webhook className="w-5 h-5 text-[#082824]" />
                                        Live Webhook Deliveries
                                    </h2>
                                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                                        {isEventsLoading ? (
                                            <div className="space-y-2.5">
                                                {Array.from({ length: 4 }).map((_, i) => (
                                                    <div key={i} className="p-4 rounded-2xl border border-black/10 bg-white flex justify-between items-center subscript-skeleton">
                                                        <div className="space-y-1.5">
                                                            <div className="h-4 w-36 rounded-full bg-[#082824]/20" />
                                                            <div className="h-3 w-24 rounded-full bg-black/10" />
                                                        </div>
                                                        <div className="h-6 w-16 rounded-full bg-black/10" />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : webhookEvents.length === 0 ? (
                                            <div className="py-12 text-center text-black/50 font-sans text-sm space-y-3">
                                                <Webhook className="w-10 h-10 mx-auto text-[#082824]/30" />
                                                <p className="font-semibold">No webhook deliveries logged yet.</p>
                                                <p className="text-xs text-black/40">Trigger events on-chain (like creating subscriptions) to see delivery reports here.</p>
                                            </div>
                                        ) : (
                                            (() => {
                                                const webhookPageSize = 5;
                                                const paginatedWebhooks = webhookEvents.slice(webhooksPage * webhookPageSize, (webhooksPage + 1) * webhookPageSize);
                                                return paginatedWebhooks.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => setSelectedWebhook(item.id)}
                                                        className={`w-full p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${
                                                            selectedWebhook === item.id 
                                                                ? "bg-[#D4E3E8] border-[#8AB4DB] shadow-sm"
                                                                : "bg-white border-black/10 hover:bg-black/[0.03]"
                                                        }`}
                                                    >
                                                        <div className="font-mono text-xs sm:text-sm space-y-1 max-w-[70%]">
                                                            <p className="font-bold text-[#082824]">{item.event}</p>
                                                            <p className="text-black/60 text-xs truncate">{item.endpointUrl}</p>
                                                            <p className="text-black/40 text-xs">{item.time}</p>
                                                        </div>
                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                                            item.status >= 200 && item.status < 300
                                                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30" 
                                                                : "bg-red-100 text-red-800 border border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30"
                                                        }`}>
                                                            HTTP {item.status}
                                                        </span>
                                                    </button>
                                                ));
                                            })()
                                        )}
                                    </div>

                                    {(() => {
                                        const webhookPageSize = 5;
                                        const totalPages = Math.ceil(webhookEvents.length / webhookPageSize);
                                        if (totalPages <= 1) return null;
                                        return (
                                            <div className="flex items-center justify-between pt-4 mt-3 border-t border-black/10 font-sans">
                                                <span className="text-xs text-black/60 font-bold uppercase tracking-wider">
                                                    Page {webhooksPage + 1} of {totalPages}
                                                </span>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={webhooksPage === 0}
                                                        onClick={() => setWebhooksPage((p) => Math.max(0, p - 1))}
                                                        className="px-4 py-2 bg-white hover:bg-black/5 disabled:opacity-30 border border-black/15 text-black rounded-full text-xs font-bold transition-all shadow-sm"
                                                    >
                                                        Prev
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={webhooksPage >= totalPages - 1}
                                                        onClick={() => setWebhooksPage((p) => Math.min(totalPages - 1, p + 1))}
                                                        className="px-4 py-2 bg-white hover:bg-black/5 disabled:opacity-30 border border-black/15 text-black rounded-full text-xs font-bold transition-all shadow-sm"
                                                    >
                                                        Next
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                
                                <div className="mt-6 pt-4 border-t border-black/10 text-xs text-black/60 flex items-center justify-between font-sans">
                                    <div className="flex items-center gap-2 font-semibold">
                                        <span className="w-2.5 h-2.5 bg-[#8AB4DB] rounded-full" />
                                        <span>Logged: {webhookEvents.length} events</span>
                                    </div>
                                    <button
                                        onClick={fetchWebhookEvents}
                                        className="text-[#082824] font-bold hover:underline flex items-center gap-1.5"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" /> Refresh logs
                                    </button>
                                </div>
                            </div>

                            {/* Payload Inspector */}
                            <div className="rounded-[34px] border border-black/10 overflow-hidden flex flex-col justify-between shadow-sm bg-[#FFFFF0]">
                                <div className="flex items-center justify-between border-b border-black/10 px-6 sm:px-8 py-5 bg-[#D4E3E8]/40">
                                    <span className="text-xs sm:text-sm font-bold text-[#082824] uppercase tracking-wider font-mono">Payload Inspector</span>
                                    <button
                                        onClick={() => handleReplayWebhook(selectedWebhook)}
                                        disabled={isReplaying || !selectedWebhook}
                                        className={`px-4 py-2 border border-black/15 bg-white rounded-full text-xs font-bold text-[#082824] hover:bg-black/5 flex items-center gap-1.5 shadow-sm ${isReplaying || !selectedWebhook ? "opacity-50" : ""}`}
                                    >
                                        {isReplaying ? <Loader2 className="w-3.5 h-3.5 animate-spin text-black" /> : <RotateCw className="w-3.5 h-3.5 text-black" />}
                                        Replay
                                    </button>
                                </div>
                                
                                <div className="flex-1 p-6 sm:p-8 font-mono text-xs sm:text-sm text-black/80 overflow-y-auto min-h-[300px] leading-relaxed select-all">
                                    {replayStatus && (
                                        <p className={`p-4 border rounded-2xl mb-4 font-sans text-xs sm:text-sm ${
                                            replayStatus.includes("successfully") 
                                                ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30" 
                                                : "bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30"
                                        }`}>{replayStatus}</p>
                                    )}
                                    {selectedPayload ? (
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-black/60 text-xs uppercase tracking-wider mb-2 font-bold">JSON Payload</p>
                                                <pre className="bg-white p-4 rounded-2xl border border-black/10 overflow-x-auto text-[#082824] font-mono text-xs sm:text-sm">
                                                    <code>{JSON.stringify(selectedPayload.payload, null, 2)}</code>
                                                </pre>
                                            </div>
                                            {selectedPayload.responseBody && (
                                                <div>
                                                    <p className="text-black/60 text-xs uppercase tracking-wider mb-2 font-bold">Response Body</p>
                                                    <pre className="bg-white p-4 rounded-2xl border border-black/10 overflow-x-auto text-black/70 max-h-[150px] font-mono text-xs">
                                                        <code>{selectedPayload.responseBody}</code>
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-black/40">Select a webhook event to inspect</span>
                                    )}
                                </div>
                                
                                <div className="border-t border-black/10 px-6 sm:px-8 py-4 bg-[#D4E3E8]/40 text-xs text-black/70 flex justify-between font-mono font-semibold">
                                    <span>Event ID: {selectedPayload?.id || "N/A"}</span>
                                    <span>HTTP Status: {selectedPayload?.status || "N/A"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            }
        }
    };

    const sidebarIdentityLabel =
        merchantAlias || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Your account");

    const handleNavSelect = (id: string) => {
        if (id === "payment-links-subscriptions") {
            setActiveTab("payment-links");
            setSubTab("subscriptions");
        } else if (id === "payment-links-one-time") {
            setActiveTab("payment-links");
            setSubTab("one-time");
        } else if (id === "payment-links-commit") {
            setActiveTab("payment-links");
            setSubTab("commit");
        } else {
            setActiveTab(id as TabId);
        }
    };

    return (
        <div data-mounted={isMounted} data-merchant-theme={resolvedTheme} className="merchant-dashboard-root relative min-h-[100dvh] overflow-x-hidden bg-[#353935] font-sans text-black selection:bg-[#8AB4DB]/45 md:h-[100dvh] md:overflow-hidden">
            <div className="relative md:flex md:h-[100dvh] md:min-h-0">
                <MerchantDashboardNav
                    activeId={activeTab}
                    activeSubTab={subTab}
                    onSelect={handleNavSelect}
                    identityLabel={sidebarIdentityLabel}
                    avatarUrl={userSettings?.profilePic || null}
                    verified={Boolean(userSettings?.verified)}
                    isAdmin={isAdmin}
                    mobileEnabled={isConnected}
                    isPremium={isPremium}
                    isLoading={Boolean(isLoading)}
                />
                <div className="merchant-dashboard-workspace relative min-w-0 flex-1 overflow-y-auto bg-[#FFFFF0] md:mt-[14px] md:h-[calc(100vh-14px)] md:rounded-tl-[28px] md:border md:border-black/10">
            {/* Session Consent Alerts Overlay */}
            {sessionAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
                    <div className="liquid-glass border border-white/10 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-6 relative overflow-hidden bg-[#0d0d0d] shadow-2xl">
                        <div className="space-y-2">
                            <span className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            </span>
                            <h2 className="text-lg font-extrabold uppercase tracking-wider text-white">
                                {sessionAlert === "role_missing" && "Account Incomplete"}
                                {sessionAlert === "wrong_role" && "Incorrect Dashboard"}
                                {sessionAlert === "wallet_mismatch" && "Wallet Mismatch"}
                            </h2>
                            <p className="text-xs text-white/50 leading-relaxed font-sans font-normal">
                                {sessionAlert === "role_missing" && "Your active profile is missing an assigned role. Please complete your registration."}
                                {sessionAlert === "wrong_role" && "This is the Enterprise Merchant dashboard, but your session is registered as a User Account."}
                                {sessionAlert === "wallet_mismatch" && "Your connected wallet address does not match your active session. Please sign in again."}
                            </p>
                        </div>

                        <button
                            onClick={async () => {
                                if (sessionAlert === "role_missing") {
                                    window.location.href = getDashboardUrl("USER", "/signup?completeRole=1");
                                } else if (sessionAlert === "wrong_role") {
                                    window.location.href = getDashboardUrl("USER", "/user");
                                } else {
                                    await fetch("/api/auth/logout", { method: "POST" });
                                    window.location.href = getDashboardUrl("USER", "/login");
                                }
                            }}
                            className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                        >
                            {sessionAlert === "role_missing" && "Complete Account Setup"}
                            {sessionAlert === "wrong_role" && "Switch to User Dashboard"}
                            {sessionAlert === "wallet_mismatch" && "Return to Login"}
                        </button>
                    </div>
                </div>
            )}
            {/* Dashboard Content */}
            <main className="mx-auto max-w-[1600px] px-4 pb-12 pt-6 sm:px-7 md:pt-8">
                {/* Top Workspace Header */}
                <div className="mb-6 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="md:hidden shrink-0">
                            <MobileProfileButton
                                identityLabel={sidebarIdentityLabel}
                                avatarUrl={userSettings?.profilePic || null}
                                isLoading={Boolean(isLoading)}
                                onOpenSettings={() => {
                                    setMerchantSubView("menu");
                                    setActiveTab("settings");
                                }}
                            />
                        </div>
                        <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight text-[#082824] truncate">
                            Merchant Dashboard
                        </h1>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                        <button
                            onClick={() => setActiveTab("premium")}
                            title="Premium"
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFFFF0] dark:bg-[#1f2023] text-[#082824] dark:text-white hover:brightness-95 transition shadow-sm border border-black/10 dark:border-white/10"
                        >
                            <Crown className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                        </button>
                        <div className="relative">
                            <NotificationBell audience="MERCHANT" accent="#082824" className="merchant-light-bell" />
                        </div>
                    </div>
                </div>
                {isLoading ? (
                    <DashboardSkeleton activeTab={activeTab} isConnected={isConnected} />
                ) : (
                    /* Navigation moved to the shared rail, so the tab body now owns the full width
                       of the content panel. */
                    <div className="min-h-[500px]">
                        {/* Keyed enter-only animation — deliberately NO AnimatePresence/exit here.
                                mode="wait" gated the incoming tab on the outgoing exit spring, which
                                dropped the presence on interrupted switches (slow mobile frames) and
                                left the content area blank. */}
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, ease: "easeOut" }}
                            >
                                {renderView()}
                            </motion.div>
                    </div>
                )}
                
                {/* Footer */}
                <footer className="mt-16 pt-8 border-t border-black/10 flex flex-col sm:flex-row justify-between items-center text-[10px] text-black/40 gap-4">
                    <span>© 2026 SubScript Protocol. All rights reserved.</span>
                    <div className="flex gap-4">
                        <Link href="/terms" className="hover:text-black transition">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-black transition">Privacy Policy</Link>
                    </div>
                    <span>Built on Arc Network</span>
                </footer>
            </main>
            </div>
            </div>
            <SupportChatModal
                open={supportChatOpen}
                onClose={() => setSupportChatOpen(false)}
                currentWallet={address}
                userRole="MERCHANT"
            />
            <WithdrawModal
                isOpen={isWithdrawOpen}
                onClose={() => setIsWithdrawOpen(false)}
                vaultBalance={vaultBalance}
                connectedAddress={address || ""}
                payoutDestination={userSettings?.payoutDestination || payoutDestination}
                onConfirmWithdraw={async (targetAddress) => {
                    await handleWithdraw(targetAddress);
                    setIsWithdrawOpen(false);
                }}
                isWithdrawing={isWithdrawing}
                isPremium={isPremium}
            />
            <QrScannerModal
                isOpen={isQrScannerOpen}
                onClose={() => setIsQrScannerOpen(false)}
                title="Scan QR code"
                onScan={(value) => {
                    setIsQrScannerOpen(false);
                    const target = resolveScannedTarget(value);
                    /* A SubScript link goes to the page it names — this is the whole reason the
                       button exists next to Send. Scanning a DM invite used to end up pasted into
                       the recipient field of the Send dialog, because the only scanner a merchant
                       could reach was the one inside it. */
                    if (target.kind === "link") {
                        router.push(target.path);
                        return;
                    }
                    /* Anything that identifies a person is a payment, so hand it to Send. */
                    setScannedRecipient(target.kind === "address" ? target.address : target.value);
                    setIsSendWalletOpen(true);
                }}
            />
            <SendWalletModal
                isOpen={isSendWalletOpen}
                initialRecipient={scannedRecipient}
                onClose={() => {
                    setIsSendWalletOpen(false);
                    setScannedRecipient("");
                }}
                walletBalance={walletBalance}
                connectedAddress={address || ""}
                isSending={isSendingWallet}
                onConfirmSend={async (recipientAddress, amountUsdc) => {
                    setIsSendingWallet(true);
                    try {
                        const microUsdc = BigInt(Math.round(amountUsdc * 1000000));
                        await executeContractWrite({
                            address: USDC_NATIVE_GAS_ADDRESS,
                            abi: ERC20_ABI,
                            functionName: "transfer",
                            args: [recipientAddress, microUsdc],
                        });
                        await refetchBalancesAndTier();
                    } finally {
                        setIsSendingWallet(false);
                    }
                }}
            />
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={!!embeddedWallet}
                depositAddress={address || ""}
                onSuccess={handleDepositSuccess}
            />
            {activeQrCodeLink && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md font-sans">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, filter: "blur(1.5px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.95, filter: "blur(1.5px)" }}
                        className="liquid-glass border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative space-y-6 text-center"
                    >
                        {/* Close button */}
                        <button
                            onClick={() => {
                                setActiveQrCodeLink(null);
                                setActiveQrCodeTitle("");
                            }}
                            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-all"
                        >
                            <span className="sr-only">Close</span>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <div className="space-y-1">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center justify-center gap-2">
                                <QrCode className="w-4 h-4 text-[#00d2b4]" />
                                Payment Link QR Code
                            </h3>
                            <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider truncate px-4">
                                {activeQrCodeTitle}
                            </p>
                        </div>

                        {/* QR Code display */}
                        <div className="flex justify-center p-4 bg-white rounded-2xl mx-auto w-fit">
                            <QRCode
                                value={activeQrCodeLink}
                                size={180}
                                ecLevel="H"
                                bgColor="#ffffff"
                                fgColor="#000000"
                                qrStyle="dots"
                                eyeRadius={[
                                    [10, 10, 0, 10], // Top-left eye
                                    [10, 10, 10, 0], // Top-right eye
                                    [10, 0, 10, 10]  // Bottom-left eye
                                ]}
                                logoImage="/logo.png"
                                logoWidth={38}
                                logoHeight={38}
                                removeQrCodeBehindLogo={true}
                                logoPadding={2}
                            />
                        </div>

                        {/* Link Display and Copy Action */}
                        <div className="space-y-2">
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider text-left">Checkout URL</p>
                            <div className="bg-black/40 border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3">
                                <span className="text-[11px] font-mono text-white/70 truncate text-left flex-1">
                                    {activeQrCodeLink}
                                </span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(activeQrCodeLink);
                                    }}
                                    className="p-1.5 text-[#00d2b4] hover:text-[#00d2b4]/80 rounded-lg hover:bg-[#00d2b4]/5 transition-all flex-shrink-0"
                                    title="Copy URL"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
            {confirmModal && (
                <ConfirmModal
                    open={confirmModal.open}
                    title={confirmModal.title}
                    description={confirmModal.description}
                    confirmLabel={confirmModal.confirmLabel}
                    cancelLabel={confirmModal.cancelLabel}
                    variant={confirmModal.variant}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={confirmModal.onCancel ?? (() => setConfirmModal(null))}
                />
            )}
            {/* High-fidelity glassmorphic toast notification for settlement confirmation */}
                            {showToast && (
                                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 liquid-glass border border-emerald-500/30 bg-black/60 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-[0_8px_32px_0_rgba(0,210,180,0.2)]">
                                    <Zap className="w-5 h-5 text-[#00d2b4] fill-[#00d2b4]/25 shrink-0" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                                        {toastMessage}
                                    </span>
                                </div>
                            )}
                        </div>
                    );
                }

function MerchantPlanRow({
    plan,
    busy,
    onToggle,
    promotion = null,
    onPromotionsChanged,
}: {
    plan: MerchantPlan;
    busy: boolean;
    onToggle: (plan: MerchantPlan) => void;
    promotion?: PlanPromotion | null;
    onPromotionsChanged?: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const subscribeUrl = buildSubscribeUrl(plan.id, typeof window !== "undefined" ? window.location.origin : undefined);

    const handleCopy = () => {
        navigator.clipboard.writeText(subscribeUrl).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div data-testid="merchant-plan-row" className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 w-full">
                    <p className="truncate text-sm font-black uppercase tracking-[0.08em] text-white">{plan.name}</p>
                    <p className="mt-1 text-xs font-bold text-[#00d2b4]">
                        {formatPlanAmount(plan.amountUsdc)} USDC / {formatPlanPeriod(plan.periodSeconds)}
                    </p>
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">
                        {plan.targetSubscriber
                            ? `${plan.active ? "Assigned API offer" : "Assigned offer closed"} for ${plan.targetSubscriber.slice(0, 6)}...${plan.targetSubscriber.slice(-4)}`
                            : plan.active ? "Live, accepting subscribers" : "Hidden from new subscribers"}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => onToggle(plan)}
                    disabled={busy}
                    className={`inline-flex w-full shrink-0 items-center justify-center rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-50 sm:w-auto ${
                        plan.active
                            ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-500/15"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-[#00d2b4] hover:bg-emerald-500/15"
                    }`}
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : plan.active ? "Deactivate" : "Reactivate"}
                </button>
            </div>

            {(plan.description || plan.detailsUrl) && (
                <div className="mt-3 space-y-1.5">
                    {plan.description && (
                        <p className="whitespace-pre-line text-[11px] leading-relaxed text-white/55">{plan.description}</p>
                    )}
                    {plan.detailsUrl && (
                        <a
                            href={plan.detailsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-[#00d2b4] transition hover:text-[#00d2b4]/80"
                        >
                            View more ↗
                        </a>
                    )}
                </div>
            )}

            {plan.active && !plan.targetSubscriber && (
                <div data-testid="merchant-plan-link-strip" className="mt-3 flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-xl border border-white/5 bg-black/30 px-3 py-2">
                    <span className="block min-w-0 flex-1 truncate font-mono text-[10px] text-white/45">{subscribeUrl}</span>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#00d2b4]/20 bg-[#00d2b4]/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00d2b4] transition hover:bg-[#00d2b4]/20"
                        title={copied ? "Copied!" : "Copy subscribe link"}
                    >
                        {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                        <span>{copied ? "Copied" : "Copy link"}</span>
                    </button>
                </div>
            )}

            {(plan.active || promotion) && (
                <PlanPromotionPanel plan={plan} promotion={promotion ?? null} onChanged={onPromotionsChanged} />
            )}
        </div>
    );
}

/* Introductory-offer controls for one plan: create, edit, activate/deactivate a promotion.
   Edits only affect FUTURE subscribers — terms already authorized are snapshotted per
   subscription and enforced on-chain, so existing subscribers never reprice. */
function PlanPromotionPanel({
    plan,
    promotion,
    onChanged,
}: {
    plan: MerchantPlan;
    promotion: PlanPromotion | null;
    onChanged?: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [promoName, setPromoName] = useState(promotion?.name || "");
    const [discountType, setDiscountType] = useState(promotion?.discountType || "PERCENT");
    const [percentOff, setPercentOff] = useState(
        promotion?.discountBps ? String(promotion.discountBps / 100) : "40",
    );
    const [introPriceUsdc, setIntroPriceUsdc] = useState(
        promotion && promotion.discountType === "FIXED_PRICE"
            ? formatPlanAmount(promotion.introductoryAmountUsdc)
            : "",
    );
    const [introCycles, setIntroCycles] = useState(String(promotion?.introductoryCycles || 1));
    const [expiresAt, setExpiresAt] = useState(
        promotion?.expiresAt ? promotion.expiresAt.slice(0, 16) : "",
    );
    const [maxRedemptions, setMaxRedemptions] = useState(
        promotion?.maxRedemptions ? String(promotion.maxRedemptions) : "",
    );
    const [newCustomersOnly, setNewCustomersOnly] = useState(promotion?.newCustomersOnly ?? true);

    const regularMicros = (() => {
        try { return BigInt(plan.amountUsdc); } catch { return BigInt(0); }
    })();
    const previewIntroMicros = (() => {
        if (discountType === "FREE_TRIAL") return BigInt(0);
        if (discountType === "PERCENT") {
            const pct = Number(percentOff);
            if (!Number.isFinite(pct) || pct < 1 || pct > 100) return null;
            return (regularMicros * BigInt(10000 - Math.round(pct * 100))) / BigInt(10000);
        }
        const price = Number(introPriceUsdc);
        if (!Number.isFinite(price) || price < 0) return null;
        return BigInt(Math.round(price * 1_000_000));
    })();
    const cadence = formatPlanPeriod(plan.periodSeconds);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (!promoName.trim()) { setError("Promotion name is required."); return; }
        if (previewIntroMicros === null) { setError("Enter a valid discount."); return; }
        if (previewIntroMicros >= regularMicros) { setError("Introductory price must be below the regular price."); return; }
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: promoName.trim(),
                discountType,
                introductoryCycles: Number(introCycles) || 1,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
                maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
                newCustomersOnly,
            };
            if (discountType === "PERCENT") payload.percentOff = Number(percentOff);
            if (discountType === "FIXED_PRICE") payload.introPriceUsdc = introPriceUsdc;
            const res = await fetch("/api/merchant/promotions", {
                method: promotion ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(promotion ? { ...payload, promotionId: promotion.id } : { ...payload, planId: plan.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to save promotion.");
            setEditing(false);
            onChanged?.();
        } catch (err: any) {
            setError(err.message || "Failed to save promotion.");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async () => {
        if (!promotion) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/merchant/promotions", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ promotionId: promotion.id, active: !promotion.active }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to update promotion.");
            onChanged?.();
        } catch (err: any) {
            setError(err.message || "Failed to update promotion.");
        } finally {
            setSaving(false);
        }
    };

    const summaryLabel = promotion
        ? promotion.discountType === "FREE_TRIAL"
            ? `Free for the first ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : cadence}`
            : promotion.discountType === "PERCENT"
                ? `${(promotion.discountBps || 0) / 100}% off → ${formatPlanAmount(promotion.introductoryAmountUsdc)} USDC for ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : `the first ${cadence}`}`
                : `${formatPlanAmount(promotion.introductoryAmountUsdc)} USDC for ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : `the first ${cadence}`}`
        : null;

    return (
        <div data-testid="plan-promotion-panel" className="mt-3 rounded-xl border border-amber-300/10 bg-amber-400/[0.03] p-3 font-sans">
            {!editing && promotion && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
                            Promotion · {promotion.active ? "Live" : "Off"} · {promotion.redemptionCount}{promotion.maxRedemptions ? `/${promotion.maxRedemptions}` : ""} redeemed
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-bold text-[#082824] dark:text-white/80">{promotion.name}: {summaryLabel}, then {formatPlanAmount(plan.amountUsdc)} USDC / {cadence}</p>
                        {promotion.expiresAt && (
                            <p className="text-[9px] text-black/50 dark:text-white/35">Offer ends {new Date(promotion.expiresAt).toLocaleDateString()}</p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => setEditing(true)} disabled={saving}
                            className="rounded-lg border border-black/15 dark:border-white/10 bg-black/5 dark:bg-white/5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#082824] dark:text-white/70 transition hover:bg-black/10 dark:hover:text-white disabled:opacity-50">
                            Edit
                        </button>
                        <button type="button" onClick={toggleActive} disabled={saving}
                            className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition disabled:opacity-50 ${promotion.active ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-500/15" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-[#00d2b4] hover:bg-emerald-500/15"}`}>
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : promotion.active ? "Turn off" : "Turn on"}
                        </button>
                    </div>
                </div>
            )}

            {!editing && !promotion && plan.active && (
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="w-full rounded-xl border border-dashed border-amber-600/30 dark:border-amber-400/30 bg-amber-500/[0.04] dark:bg-amber-400/[0.06] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 transition hover:border-amber-600/60 dark:hover:border-amber-400/60 hover:bg-amber-500/[0.08] dark:hover:bg-amber-400/[0.1] shadow-xs"
                >
                    + Add introductory offer (discount or free trial)
                </button>
            )}

            {editing && (
                <form onSubmit={submit} className="space-y-3 text-xs">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer name</label>
                            <input type="text" value={promoName} onChange={(e) => setPromoName(e.target.value)} placeholder="Launch offer"
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer type</label>
                            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none">
                                <option value="PERCENT">Percentage off</option>
                                <option value="FIXED_PRICE">Fixed intro price</option>
                                <option value="FREE_TRIAL">Free trial</option>
                            </select>
                        </div>
                        {discountType === "PERCENT" && (
                            <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Percent off (customer pays the rest)</label>
                                <input type="number" min="1" max="100" step="1" value={percentOff} onChange={(e) => setPercentOff(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                            </div>
                        )}
                        {discountType === "FIXED_PRICE" && (
                            <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Intro price (USDC)</label>
                                <input type="number" min="0" step="0.01" value={introPriceUsdc} onChange={(e) => setIntroPriceUsdc(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                            </div>
                        )}
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Discounted cycles</label>
                            <input type="number" min="1" max="36" value={introCycles} onChange={(e) => setIntroCycles(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer ends (optional)</label>
                            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Max redemptions (optional)</label>
                            <input type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited"
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-[10px] text-white/60">
                        <input type="checkbox" checked={newCustomersOnly} onChange={(e) => setNewCustomersOnly(e.target.checked)} className="accent-[#00d2b4]" />
                        New customers only (subscribers who never had a plan with you)
                    </label>
                    {previewIntroMicros !== null && previewIntroMicros < regularMicros && (
                        <p className="rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-[10px] text-white/60">
                            Customers pay <span className="font-bold text-[#00d2b4]">{formatPlanAmount(previewIntroMicros.toString())} USDC</span>
                            {Number(introCycles) > 1 ? ` per ${cadence} for ${introCycles} cycles` : " today"}, then{" "}
                            <span className="font-bold text-white/85">{formatPlanAmount(plan.amountUsdc)} USDC / {cadence}</span>. Both prices are
                            disclosed and authorized at checkout; the switch to full price is enforced on-chain.
                        </p>
                    )}
                    {error && <p className="text-[10px] font-bold text-red-400">{error}</p>}
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setEditing(false); setError(null); }} disabled={saving}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white/60 transition hover:text-white disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="rounded-lg bg-[#00d2b4] px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-black transition hover:bg-[#00d2b4]/85 disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : promotion ? "Save changes" : "Launch offer"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}

/* Mobile-only account entry point, mirroring the user dashboard's HomeHeader: the first tap
   expands the pill to name the account, the second opens settings. A single-tap version had no
   way to tell you what account you were about to open, and a 40px unlabelled circle in the corner
   did not read as a control at all.
 *
 * The skeleton branch matters because this button is fixed-positioned outside the workspace, so
 * it used to paint an initial or a stale avatar over a page that was otherwise still loading. */
function MobileProfileButton({
    identityLabel,
    avatarUrl,
    isLoading,
    onOpenSettings,
}: {
    identityLabel: string;
    avatarUrl: string | null;
    isLoading: boolean;
    onOpenSettings: () => void;
}) {
    const [expanded, setExpanded] = useState(false);

    /* Collapse when the tap lands anywhere else, so an expanded pill cannot be left sitting over
       the content it is covering. */
    useEffect(() => {
        if (!expanded) return;
        const collapse = () => setExpanded(false);
        const timer = window.setTimeout(() => {
            document.addEventListener("pointerdown", collapse, { once: true });
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", collapse);
        };
    }, [expanded]);

    if (isLoading) {
        return (
            <div className="relative" aria-hidden="true">
                <div className="subscript-skeleton h-9 w-9 rounded-full" />
            </div>
        );
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => {
                    if (!expanded) {
                        setExpanded(true);
                        return;
                    }
                    setExpanded(false);
                    onOpenSettings();
                }}
                className={`flex h-9 items-center gap-2 overflow-hidden rounded-full border border-black/10 bg-[#FFFFF0] dark:bg-[#1f2023] text-black dark:text-white shadow-sm transition-all duration-300 ${
                    expanded ? "max-w-[calc(100vw-8rem)] pl-0 pr-3" : "w-9 justify-center"
                }`}
                aria-label={expanded ? "Open account settings" : "Show account"}
                aria-expanded={expanded}
                title={expanded ? "Open account settings" : identityLabel}
            >
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <span className="font-mono text-xs font-bold text-[#082824] dark:text-white">
                            {identityLabel.slice(0, 1).toUpperCase()}
                        </span>
                    )}
                </span>
                {expanded && (
                    <span className="truncate text-[11px] font-semibold text-[#082824] dark:text-white">{identityLabel}</span>
                )}
            </button>
        </div>
    );
}

function LocalCustomerVaultRow({
    vault,
    apiKey,
    onRefresh,
}: {
    vault: any;
    apiKey: string;
    onRefresh: () => void;
}) {
    const [chargeAmount, setChargeAmount] = useState("1.50");
    const [loading, setLoading] = useState(false);
    const [reviewingCharge, setReviewingCharge] = useState(false);
    const usageRequestKey = useRef<string | null>(null);
    const usageInFlight = useRef(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const handleReportUsage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) {
            setStatus({ text: "A newly revealed secret key is required for live usage reporting. Roll or create an API key and copy it while it is shown.", type: "error" });
            return;
        }

        if (!reviewingCharge) {
            setStatus(null);
            setReviewingCharge(true);
            return;
        }
        if (!chargeAmount || isNaN(Number(chargeAmount)) || Number(chargeAmount) <= 0) {
            setStatus({ text: "Invalid usage amount.", type: "error" });
            return;
        }

        if (usageInFlight.current) return;
        usageInFlight.current = true;
        usageRequestKey.current ||= crypto.randomUUID();

        setLoading(true);
        setStatus(null);

        try {
            const res = await fetch("/api/user/vault/report-usage", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "x-request-id": usageRequestKey.current,
                },
                body: JSON.stringify({
                    /* The vault's own id, not the customer's address — this list is no longer told
                       whose deposit each row is. Scoped to the authenticated merchant server-side. */
                    vaultId: vault.id,
                    amountUsdc: chargeAmount
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setStatus({
                    text: `Usage charge accrued. Cycle total: ${formatUsdcMicros(data.accruedUsageUsdc)} USDC.`,
                    type: "success"
                });
                setReviewingCharge(false);
                usageRequestKey.current = null;
                onRefresh();
            } else {
                setStatus({ text: data.error || "Usage report failed.", type: "error" });
            }
        } catch (err: any) {
            setStatus({ text: err.message || "Failed to report usage.", type: "error" });
        } finally {
            usageInFlight.current = false;
            setLoading(false);
        }
    };

    const cycleStart = vault.cycleStart ? new Date(vault.cycleStart).toLocaleDateString() : "Not started";
    const owedMicros = microsToNumber(vault.owedUsdc);
    const isActive = Boolean(vault.active);

    return (
        <div className="flex flex-col gap-4 rounded-[24px] border border-black/10 bg-white hover:bg-black/[0.02] transition p-5 shadow-sm font-sans">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        {/* Email when the customer volunteered one at this merchant's own checkout,
                            otherwise the opaque deposit reference. Never the wallet address. */}
                        <p className={`text-sm sm:text-base font-bold text-[#082824] ${vault.payerEmail ? "break-words" : "font-mono break-all"}`}>
                            {vault.payerEmail || vault.reference || "Deposit"}
                        </p>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                            isActive ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20" : "bg-red-500/10 text-red-600 border border-red-500/20"
                        }`}>
                            {isActive ? "Active" : "Inactive"}
                        </span>
                    </div>
                    <p className="text-xs text-black/50 mt-1">
                        Vault cycle start: <span className="text-black/80 font-medium">{cycleStart}</span>
                    </p>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div>
                        <span className="text-xs font-bold text-black/60 uppercase tracking-wider block">Customer Balance</span>
                        <p className="text-base sm:text-lg font-black text-[#082824] mt-1">${formatUsdcMicros(vault.balanceUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-xs font-bold text-black/60 uppercase tracking-wider block">Required Deposit</span>
                        <p className="text-base sm:text-lg font-black text-black/80 mt-1">${formatUsdcMicros(vault.commitUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-xs font-bold text-black/60 uppercase tracking-wider block">Unbilled Usage</span>
                        <p className="text-base sm:text-lg font-black text-[#082824] mt-1">${formatUsdcMicros(vault.accruedUsageUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-xs font-bold text-black/60 uppercase tracking-wider block">Overdue</span>
                        <p className={`text-base sm:text-lg font-black mt-1 ${owedMicros > 0 ? "text-red-600" : "text-black/80"}`}>${formatUsdcMicros(vault.owedUsdc)}</p>
                    </div>
                </div>
            </div>

            {/* Live usage accrual tool */}
            <form onSubmit={handleReportUsage} className="flex flex-col sm:flex-row gap-3 sm:items-end border-t border-black/10 pt-4">
                <label className="flex-1 space-y-1.5">
                    <span className="text-xs sm:text-sm font-bold text-[#082824]">Bill usage (USDC)</span>
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        disabled={loading}
                        value={chargeAmount}
                        onChange={(e) => { setChargeAmount(e.target.value); setReviewingCharge(false); setStatus(null); usageRequestKey.current = null; }}
                        className="w-full max-w-xs bg-[#FFFFF0] border border-black/15 rounded-2xl px-4 py-2.5 text-black focus:outline-none focus:border-[#8AB4DB] transition text-sm sm:text-base font-mono disabled:opacity-50"
                        placeholder="1.50"
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2.5 bg-[#000000] hover:bg-black/85 disabled:opacity-50 text-xs sm:text-sm font-bold text-white rounded-full flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 text-white" />}
                    {reviewingCharge ? "Confirm charge" : "Review charge"}
                </button>
            </form>

            {reviewingCharge && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs sm:text-sm leading-relaxed text-amber-900">
                    This will add <strong>{Number(chargeAmount).toFixed(2)} USDC</strong> to the customer&apos;s live unbilled usage for this billing cycle. It is not a test. Review the customer address above before confirming.
                    <button type="button" onClick={() => setReviewingCharge(false)} className="mt-2 block font-bold uppercase tracking-wider text-[#082824] hover:underline">Back to edit</button>
                </div>
            )}

            {status && (
                <p className={`text-xs sm:text-sm font-bold tracking-wide ${
                    status.type === "success" ? "text-emerald-700" : "text-red-600"
                }`}>
                    {status.text}
                </p>
            )}
        </div>
    );
}
